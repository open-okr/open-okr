/**
 * The guided cycle workflow's writes (TECHNICAL-PLAN §4.3, METHOD.md §2, §4.5,
 * P3-T03).
 *
 * Every write here ends the same way: it recomputes the six gate rows before its
 * transaction commits, which is what §4.3 means by "recomputed on every relevant
 * write". `withGateRecompute` is the only path, so a new workflow write cannot
 * forget to do it.
 *
 * **Publication re-evaluates rather than reading the stored gates.** The rows are
 * a cache of an evaluation, and trusting a cache is exactly how a set gets
 * published through a gate that went red after the row was written.
 */
import {
  activeOnly,
  cycleBaselineHealth,
  cycleCalibrations,
  cycleCapacityNotes,
  cycleIssues,
  cyclePackItems,
  cyclePriorities,
  cycleRevalidations,
  cycles,
  ISSUE_SOURCES,
  newId,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { INPUT_PACK_ITEMS } from "@openokr/method";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { localDateIn, parseLocalDate } from "../cycles/generation.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import {
  ensurePackItemsInTx,
  evaluateWorkflow,
  loadCycleForWorkflow,
  readPackItems,
  recomputeGateState,
} from "../cycles/workflow.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { recomputeForCycle } from "../scoring/recompute.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** Editor JSON, validated before it reaches storage. Never Markdown. */
const richText = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const phaseResult = z.object({
  phase: z.number().int(),
  title: z.string(),
  state: z.enum(["pass", "todo", "not_applicable"]),
  missing: z.array(z.string()),
  blocked: z.array(z.string()),
  conditions: z.object({
    met: z.number().int(),
    total: z.number().int(),
  }),
});

const gateResult = z.object({
  gateKey: z.number().int(),
  title: z.string(),
  passed: z.boolean(),
  evaluable: z.boolean(),
  missing: z.array(z.string()),
  blocked: z.string().nullable(),
});

/** Loads the cycle, evaluates, stores the gate rows, and hands back the result. */
async function withGateRecompute(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
) {
  const cycle = await loadCycleForWorkflow(tx, workspaceId, cycleId);
  if (!cycle) {
    throw new OperationError("not_found", "No such cycle.");
  }
  if (cycle.status === "closed") {
    throw new OperationError(
      "forbidden",
      "This cycle is closed. Its record does not change after the archive.",
    );
  }
  const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
  const snapshot = await evaluateWorkflow(
    tx,
    workspaceId,
    cycle,
    rhythm.thresholds,
  );
  await recomputeGateState(tx, workspaceId, cycleId, snapshot.gates);
  return { cycle, snapshot };
}

/** Resolves the acting member, refusing the way every other read does. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

/** A named role, or null where nobody holds it yet. */
async function memberSummary(
  tx: OperationTx,
  workspaceId: string,
  memberId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!memberId) {
    return null;
  }
  const [row] = await tx
    .select({ id: workspaceMembers.id, name: workspaceMembers.name })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.id, memberId),
      ),
    )
    .limit(1);
  return row ? { id: row.id, name: row.name } : null;
}

/**
 * Calendar days from today to a local deadline date, in the workspace timezone.
 *
 * The countdown is computed on the server for the same reason the cycle bounds
 * are: the deadline is a date in the workspace's calendar, and a browser in
 * another timezone would count from the wrong today.
 */
async function daysToDeadline(
  tx: OperationTx,
  workspaceId: string,
  deadline: string | null,
): Promise<number | null> {
  if (!deadline) {
    return null;
  }
  const timeZone = await workspaceTimeZone(tx, workspaceId);
  const today = localDateIn(new Date(), timeZone);
  const target = parseLocalDate(deadline);
  const asUtc = (date: { year: number; month: number; day: number }): number =>
    Date.UTC(date.year, date.month - 1, date.day);
  return Math.round((asUtc(target) - asUtc(today)) / 86_400_000);
}

export const readWorkflow = defineReadAction({
  name: "workflow.read",
  summary:
    "A cycle's phase completion, its six publish gates and the rows they are computed from.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    cycleId: z.uuid(),
    name: z.string(),
    mode: z.enum(["annual", "quarterly"]),
    phase: z.number().int(),
    status: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
    publicationDeadline: z.string().nullable(),
    /**
     * Calendar days from today to the publication deadline, read in the
     * workspace timezone. Negative once it has passed, null when none is set.
     * Computed here rather than in a browser: a reader in another timezone is
     * still planning this workspace's cycle.
     */
    daysToDeadline: z.number().int().nullable(),
    publishedAt: z.string().nullable(),
    packDistributedAt: z.string().nullable(),
    firstCycle: z.boolean(),
    sponsor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    facilitator: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    publishable: z.boolean(),
    /**
     * The §11 parameters the phase panels state out loud, resolved for this
     * workspace. A surface that read the canon defaults instead would tell a
     * workspace that deviates the wrong number.
     */
    asks: z.object({
      strategicIssues: z.number().int(),
      priorities: z.object({
        low: z.number().int(),
        high: z.number().int(),
      }),
    }),
    phases: z.array(phaseResult),
    gates: z.array(gateResult),
    packItems: z.array(
      z.object({
        id: z.uuid().nullable(),
        itemKey: z.number().int(),
        label: z.string(),
        gathered: z.boolean(),
        note: z.string().nullable(),
      }),
    ),
    issues: z.array(
      z.object({
        id: z.uuid(),
        text: z.string(),
        impact: z.number().int(),
        source: z.enum(ISSUE_SOURCES),
        promotedToPriorityId: z.uuid().nullable(),
      }),
    ),
    priorities: z.array(
      z.object({
        id: z.uuid(),
        text: z.string(),
        successStatement: z.string().nullable(),
        position: z.number().int(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such cycle.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const cycle = await loadCycleForWorkflow(
          tx,
          context.workspaceId,
          input.cycleId,
        );
        if (!cycle) {
          throw new OperationError("not_found", "No such cycle.");
        }
        const rhythm = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        const snapshot = await evaluateWorkflow(
          tx,
          context.workspaceId,
          cycle,
          rhythm.thresholds,
        );

        const packItems = await readPackItems(
          tx,
          context.workspaceId,
          input.cycleId,
        );
        const issues = await tx
          .select({
            id: cycleIssues.id,
            text: cycleIssues.text,
            impact: cycleIssues.impact,
            source: cycleIssues.source,
            promotedToPriorityId: cycleIssues.promotedToPriorityId,
          })
          .from(cycleIssues)
          .where(
            activeOnly(
              cycleIssues,
              eq(cycleIssues.workspaceId, context.workspaceId),
              eq(cycleIssues.cycleId, input.cycleId),
            ),
          )
          .orderBy(desc(cycleIssues.impact));
        const priorities = await tx
          .select({
            id: cyclePriorities.id,
            text: cyclePriorities.text,
            successStatement: cyclePriorities.successStatement,
            position: cyclePriorities.position,
          })
          .from(cyclePriorities)
          .where(
            activeOnly(
              cyclePriorities,
              eq(cyclePriorities.workspaceId, context.workspaceId),
              eq(cyclePriorities.cycleId, input.cycleId),
            ),
          )
          .orderBy(asc(cyclePriorities.position));

        return {
          cycleId: cycle.id,
          name: cycle.name,
          mode: cycle.mode,
          phase: cycle.phase,
          status: cycle.status,
          startsOn: cycle.startsOn,
          endsOn: cycle.endsOn,
          publicationDeadline: cycle.publicationDeadline,
          daysToDeadline: await daysToDeadline(
            tx,
            context.workspaceId,
            cycle.publicationDeadline,
          ),
          publishedAt: cycle.publishedAt
            ? new Date(cycle.publishedAt).toISOString()
            : null,
          packDistributedAt: cycle.packDistributedAt
            ? new Date(cycle.packDistributedAt).toISOString()
            : null,
          firstCycle: cycle.firstCycle,
          sponsor: await memberSummary(
            tx,
            context.workspaceId,
            cycle.sponsorId,
          ),
          facilitator: await memberSummary(
            tx,
            context.workspaceId,
            cycle.facilitatorId,
          ),
          publishable: snapshot.publishable,
          asks: {
            strategicIssues:
              rhythm.thresholds["quality.strategicIssueBounds"].low,
            priorities: rhythm.thresholds["quality.priorityBounds"],
          },
          phases: snapshot.phases.map((result) => ({
            ...result,
            missing: [...result.missing],
            blocked: [...result.blocked],
          })),
          gates: snapshot.gates.map((gate) => ({
            gateKey: gate.gateKey,
            title: gate.title,
            passed: gate.passed,
            evaluable: gate.evaluable,
            missing: [...gate.detail.missing],
            blocked: gate.detail.blocked ?? null,
          })),
          packItems,
          issues,
          priorities,
        };
      },
    );
  },
});

export const setPackItem = defineWriteAction({
  name: "workflow.setPackItem",
  summary:
    "Marks one of the seven §2.6 input-pack items gathered, with a note.",
  input: z.object({
    cycleId: z.uuid(),
    itemKey: z.number().int().min(1).max(INPUT_PACK_ITEMS.length),
    gathered: z.boolean(),
    note: z.string().trim().max(2000).nullable().optional(),
  }),
  output: z.object({ itemKey: z.number().int(), gathered: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      await ensurePackItemsInTx(tx, workspaceId, input.cycleId);

      const [updated] = await tx
        .update(cyclePackItems)
        .set({
          gathered: input.gathered,
          ...(input.note === undefined ? {} : { note: input.note }),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            cyclePackItems,
            eq(cyclePackItems.workspaceId, workspaceId),
            eq(cyclePackItems.cycleId, input.cycleId),
            eq(cyclePackItems.itemKey, input.itemKey),
          ),
        )
        .returning({ itemKey: cyclePackItems.itemKey });
      if (!updated) {
        throw new OperationError("not_found", "No such cycle.");
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { itemKey: input.itemKey, gathered: input.gathered },
        activity: {
          kind: "cycle.pack_item_set",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { itemKey: input.itemKey, gathered: input.gathered },
        },
        audit: {
          action: "workflow.setPackItem",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { itemKey: input.itemKey, gathered: input.gathered },
        },
      };
    },
  }),
});

export const distributePack = defineWriteAction({
  name: "workflow.distributePack",
  summary:
    "Records that the input pack reached people, which the §2.6 lead time is measured from.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({ distributedAt: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const at = new Date();
      const [updated] = await tx
        .update(cycles)
        .set({ packDistributedAt: at, updatedAt: at })
        .where(
          activeOnly(
            cycles,
            eq(cycles.id, input.cycleId),
            eq(cycles.workspaceId, workspaceId),
          ),
        )
        .returning({ id: cycles.id, name: cycles.name });
      if (!updated) {
        throw new OperationError("not_found", "No such cycle.");
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { distributedAt: at.toISOString() },
        activity: {
          kind: "cycle.pack_distributed",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { name: updated.name },
        },
        audit: {
          action: "workflow.distributePack",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { name: updated.name },
        },
      };
    },
  }),
});

export const addIssue = defineWriteAction({
  name: "workflow.addIssue",
  summary: "Adds a ranked strategic issue to a cycle's phase 2 list.",
  input: z.object({
    cycleId: z.uuid(),
    text: z.string().trim().min(1).max(500),
    impact: z.number().int().min(1).max(5).default(3),
    source: z.enum(ISSUE_SOURCES).default("manual"),
  }),
  output: z.object({ id: z.uuid(), impact: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [inserted] = await tx
        .insert(cycleIssues)
        .values({
          id: newId(),
          workspaceId,
          cycleId: input.cycleId,
          text: input.text,
          impact: input.impact,
          source: input.source,
        })
        .returning({ id: cycleIssues.id });
      if (!inserted) {
        throw new Error("The issue insert returned no row.");
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { id: inserted.id, impact: input.impact },
        activity: {
          kind: "cycle.issue_added",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { impact: input.impact, source: input.source },
        },
        audit: {
          action: "workflow.addIssue",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { issueId: inserted.id, impact: input.impact },
        },
      };
    },
  }),
});

export const setIssueImpact = defineWriteAction({
  name: "workflow.setIssueImpact",
  summary: "Reranks a strategic issue. The list is ordered by impact.",
  input: z.object({
    cycleId: z.uuid(),
    issueId: z.uuid(),
    impact: z.number().int().min(1).max(5),
  }),
  output: z.object({ id: z.uuid(), impact: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [updated] = await tx
        .update(cycleIssues)
        .set({ impact: input.impact, updatedAt: new Date() })
        .where(
          activeOnly(
            cycleIssues,
            eq(cycleIssues.id, input.issueId),
            eq(cycleIssues.workspaceId, workspaceId),
            eq(cycleIssues.cycleId, input.cycleId),
          ),
        )
        .returning({ id: cycleIssues.id });
      if (!updated) {
        throw new OperationError("not_found", "No such issue.");
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { id: updated.id, impact: input.impact },
        activity: {
          kind: "cycle.issue_reranked",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { impact: input.impact },
        },
        audit: {
          action: "workflow.setIssueImpact",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { issueId: updated.id, impact: input.impact },
        },
      };
    },
  }),
});

export const addPriority = defineWriteAction({
  name: "workflow.addPriority",
  summary:
    "Adds a phase 3 priority, optionally promoting the issue it came from.",
  input: z.object({
    cycleId: z.uuid(),
    text: z.string().trim().min(1).max(500),
    successStatement: z.string().trim().max(1000).nullable().optional(),
    /** The issue this priority answers, which is then marked as promoted. */
    fromIssueId: z.uuid().optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [last] = await tx
        .select({ position: cyclePriorities.position })
        .from(cyclePriorities)
        .where(
          activeOnly(
            cyclePriorities,
            eq(cyclePriorities.workspaceId, workspaceId),
            eq(cyclePriorities.cycleId, input.cycleId),
          ),
        )
        .orderBy(desc(cyclePriorities.position))
        .limit(1);

      const [inserted] = await tx
        .insert(cyclePriorities)
        .values({
          id: newId(),
          workspaceId,
          cycleId: input.cycleId,
          text: input.text,
          successStatement: input.successStatement ?? null,
          position: (last?.position ?? -1) + 1,
        })
        .returning({ id: cyclePriorities.id });
      if (!inserted) {
        throw new Error("The priority insert returned no row.");
      }

      if (input.fromIssueId) {
        const [promoted] = await tx
          .update(cycleIssues)
          .set({ promotedToPriorityId: inserted.id, updatedAt: new Date() })
          .where(
            activeOnly(
              cycleIssues,
              eq(cycleIssues.id, input.fromIssueId),
              eq(cycleIssues.workspaceId, workspaceId),
              eq(cycleIssues.cycleId, input.cycleId),
            ),
          )
          .returning({ id: cycleIssues.id });
        if (!promoted) {
          throw new OperationError("not_found", "No such issue to promote.");
        }
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { id: inserted.id },
        activity: {
          kind: "cycle.priority_added",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { promoted: Boolean(input.fromIssueId) },
        },
        audit: {
          action: "workflow.addPriority",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: {
            priorityId: inserted.id,
            fromIssueId: input.fromIssueId ?? null,
          },
        },
      };
    },
  }),
});

export const setRevalidation = defineWriteAction({
  name: "workflow.setRevalidation",
  summary:
    "Records the quarterly revalidation: the frame holds, or changed with a note.",
  input: z
    .object({
      cycleId: z.uuid(),
      holds: z.boolean(),
      changed: z.boolean(),
      changeNote: z.string().trim().max(2000).nullable().optional(),
      focusNote: z.string().trim().max(2000).nullable().optional(),
    })
    .refine((value) => !(value.changed && !value.changeNote?.trim()), {
      message:
        "A frame recorded as changed needs a note saying what changed (§2.1: it is revalidated, never rewritten)",
    }),
  output: z.object({ cycleId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const values = {
        holds: input.holds,
        changed: input.changed,
        changeNote: input.changeNote ?? null,
        focusNote: input.focusNote ?? null,
        updatedAt: new Date(),
      };
      const [existing] = await tx
        .select({ cycleId: cycleRevalidations.cycleId })
        .from(cycleRevalidations)
        .where(
          activeOnly(
            cycleRevalidations,
            eq(cycleRevalidations.cycleId, input.cycleId),
            eq(cycleRevalidations.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(cycleRevalidations)
          .set(values)
          .where(
            activeOnly(
              cycleRevalidations,
              eq(cycleRevalidations.cycleId, input.cycleId),
            ),
          );
      } else {
        await tx
          .insert(cycleRevalidations)
          .values({ cycleId: input.cycleId, workspaceId, ...values });
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { cycleId: input.cycleId },
        activity: {
          kind: "cycle.revalidated",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { holds: input.holds, changed: input.changed },
        },
        audit: {
          action: "workflow.setRevalidation",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { holds: input.holds, changed: input.changed },
        },
      };
    },
  }),
});

export const setBaselineHealth = defineWriteAction({
  name: "workflow.setBaselineHealth",
  summary:
    "Records phase 2's KPI reading in the three §8.5 columns: stable, declining, business as usual.",
  input: z.object({
    cycleId: z.uuid(),
    stable: richText.optional(),
    declining: richText.optional(),
    businessAsUsual: richText.optional(),
  }),
  output: z.object({ cycleId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const version = RICH_TEXT_SCHEMA_VERSION;
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.stable !== undefined) {
        values.stable = input.stable;
        values.stableVersion = input.stable === null ? null : version;
      }
      if (input.declining !== undefined) {
        values.declining = input.declining;
        values.decliningVersion = input.declining === null ? null : version;
      }
      if (input.businessAsUsual !== undefined) {
        values.businessAsUsual = input.businessAsUsual;
        values.businessAsUsualVersion =
          input.businessAsUsual === null ? null : version;
      }

      const [existing] = await tx
        .select({ cycleId: cycleBaselineHealth.cycleId })
        .from(cycleBaselineHealth)
        .where(
          activeOnly(
            cycleBaselineHealth,
            eq(cycleBaselineHealth.cycleId, input.cycleId),
            eq(cycleBaselineHealth.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(cycleBaselineHealth)
          .set(values)
          .where(
            activeOnly(
              cycleBaselineHealth,
              eq(cycleBaselineHealth.cycleId, input.cycleId),
            ),
          );
      } else {
        await tx
          .insert(cycleBaselineHealth)
          .values({ cycleId: input.cycleId, workspaceId, ...values });
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { cycleId: input.cycleId },
        activity: {
          kind: "cycle.baseline_health_set",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: {},
        },
        audit: {
          action: "workflow.setBaselineHealth",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { fields: Object.keys(values) },
        },
      };
    },
  }),
});

export const setCapacityNotes = defineWriteAction({
  name: "workflow.setCapacityNotes",
  summary:
    "Records what was cut, which publish gate 5 reads (§5.5: if nothing was cut, capacity was not checked).",
  input: z.object({ cycleId: z.uuid(), cuts: richText }),
  output: z.object({ cycleId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const values = {
        cuts: input.cuts,
        cutsVersion: input.cuts === null ? null : RICH_TEXT_SCHEMA_VERSION,
        updatedAt: new Date(),
      };
      const [existing] = await tx
        .select({ cycleId: cycleCapacityNotes.cycleId })
        .from(cycleCapacityNotes)
        .where(
          activeOnly(
            cycleCapacityNotes,
            eq(cycleCapacityNotes.cycleId, input.cycleId),
            eq(cycleCapacityNotes.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(cycleCapacityNotes)
          .set(values)
          .where(
            activeOnly(
              cycleCapacityNotes,
              eq(cycleCapacityNotes.cycleId, input.cycleId),
            ),
          );
      } else {
        await tx
          .insert(cycleCapacityNotes)
          .values({ cycleId: input.cycleId, workspaceId, ...values });
      }

      await withGateRecompute(tx, workspaceId, input.cycleId);

      return {
        result: { cycleId: input.cycleId },
        activity: {
          kind: "cycle.capacity_recorded",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: {},
        },
        audit: {
          action: "workflow.setCapacityNotes",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: {},
        },
      };
    },
  }),
});

export const calibrateCycle = defineWriteAction({
  name: "workflow.calibrate",
  summary:
    "Records the one mid-cycle calibration a cycle is allowed (METHOD.md §7.6).",
  input: z.object({
    cycleId: z.uuid(),
    reason: z.string().trim().min(1).max(2000),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const [existing] = await tx
        .select({ id: cycleCalibrations.id })
        .from(cycleCalibrations)
        .where(
          activeOnly(
            cycleCalibrations,
            eq(cycleCalibrations.workspaceId, workspaceId),
            eq(cycleCalibrations.cycleId, input.cycleId),
          ),
        )
        .limit(1);
      if (existing) {
        // §7.6 allows one. The unique index would refuse the second anyway; this
        // turns a constraint violation into a sentence somebody can read.
        throw new OperationError(
          "forbidden",
          "This cycle has already been calibrated once, and §7.6 allows one.",
        );
      }

      const [inserted] = await tx
        .insert(cycleCalibrations)
        .values({
          id: newId(),
          workspaceId,
          cycleId: input.cycleId,
          reason: input.reason,
          authorMemberId: actor.memberId,
        })
        .returning({ id: cycleCalibrations.id });
      if (!inserted) {
        throw new Error("The calibration insert returned no row.");
      }

      return {
        result: { id: inserted.id },
        activity: {
          kind: "cycle.calibrated",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: {},
        },
        audit: {
          action: "workflow.calibrate",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { reason: input.reason },
        },
      };
    },
  }),
});

export const publishCycle = defineWriteAction({
  name: "workflow.publish",
  summary:
    "Publishes the set, refusing while any of the six gates is red or cannot be evaluated.",
  input: z.object({
    cycleId: z.uuid(),
    /**
     * The override, and the reason for it (METHOD.md §4.5, P4-T03).
     *
     * §4.5 makes the six gates hard, and a product with no way past a hard
     * refusal is a product people leave. So the override exists, and everything
     * about it is designed to be uncomfortable: it needs the same `full` access
     * publishing needs, it needs a reason written in the sentence somebody will
     * read six months later, and it writes an audit row naming who did it and
     * which gates were red at the time.
     *
     * The reason is not optional and not defaulted. An override with no reason
     * is indistinguishable from a bug.
     */
    override: z
      .object({ reason: z.string().trim().min(20).max(2000) })
      .optional(),
  }),
  output: z.object({
    cycleId: z.uuid(),
    publishedAt: z.string(),
    overrodeGates: z.array(z.number().int()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      // Re-evaluated, never read from `cycle_gate_state`. A stored gate row is a
      // cache, and trusting a cache is how a set gets published through a gate
      // that went red after the row was written.
      const { cycle, snapshot } = await withGateRecompute(
        tx,
        workspaceId,
        input.cycleId,
      );

      if (cycle.publishedAt) {
        throw new OperationError(
          "forbidden",
          "This cycle is already published.",
        );
      }

      const red = snapshot.gates.filter(
        (gate) => !gate.passed || !gate.evaluable,
      );
      if (red.length > 0 && !input.override) {
        const reasons = red.map((gate) => {
          const detail = gate.evaluable
            ? gate.detail.missing.join("; ")
            : `cannot be evaluated: ${gate.detail.blocked}`;
          return `Gate ${gate.gateKey} (${gate.title}): ${detail}`;
        });
        throw new OperationError(
          "forbidden",
          `The set cannot be published until all six gates are green. ${reasons.join(" ")}`,
        );
      }
      if (input.override && red.length === 0) {
        // Refused rather than ignored. An override recorded against nothing
        // teaches the reader of the audit log that overrides are routine.
        throw new OperationError(
          "forbidden",
          "Every gate is green, so there is nothing to override.",
        );
      }
      const overrodeGates = red.map((gate) => gate.gateKey);

      const at = new Date();
      // Publication is the moment the set becomes the thing everybody reads, so
      // every derived column in it is settled here rather than on the next write
      // to each goal (P3-T05).
      const { thresholds } = resolveRhythm(
        await readRhythmRow(tx, workspaceId),
      );
      await recomputeForCycle(tx, workspaceId, input.cycleId, thresholds, at);
      await tx
        .update(cycles)
        .set({ publishedAt: at, status: "active", phase: 6, updatedAt: at })
        .where(activeOnly(cycles, eq(cycles.id, input.cycleId)));

      return {
        result: {
          cycleId: input.cycleId,
          publishedAt: at.toISOString(),
          overrodeGates,
        },
        activity: {
          kind: "cycle.published",
          subjectType: "cycle",
          subjectId: input.cycleId,
          payload: { name: cycle.name, overrodeGates },
        },
        audit: {
          // A different action name when a gate was overridden, so the audit
          // log can be read for overrides without parsing a payload. Somebody
          // asking "has anybody ever published past a red gate" should not have
          // to know the shape of a JSON column to find out.
          action:
            overrodeGates.length > 0 ? "workflow.override" : "workflow.publish",
          targetType: "cycle",
          targetId: input.cycleId,
          payload:
            overrodeGates.length > 0
              ? {
                  name: cycle.name,
                  overrodeGates,
                  reason: input.override?.reason,
                  gates: red.map((gate) => ({
                    gateKey: gate.gateKey,
                    title: gate.title,
                    missing: gate.detail.missing,
                    blocked: gate.detail.blocked ?? null,
                  })),
                }
              : { name: cycle.name },
        },
      };
    },
  }),
});
