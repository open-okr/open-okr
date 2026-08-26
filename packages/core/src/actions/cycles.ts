/**
 * Cycle, annual frame and rhythm actions (TECHNICAL-PLAN §4.3, METHOD.md §2.1,
 * §11, P3-T02).
 *
 * The annual frame is read-only reference material during a quarterly cycle
 * (METHOD.md §2.1: "Phase 3 of a quarterly cycle revalidates it. It does not
 * rewrite it"), so `frame.update` refuses while a quarterly cycle is the one
 * being run, and superseding rather than editing is how a new year begins.
 */
import {
  activeOnly,
  annualFrames,
  annualStrategies,
  CYCLE_CADENCES,
  cycles,
  GOAL_LEVELS,
  performanceSnapshots,
  rhythmSettings,
  scorecardSettings,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import {
  CHECK_IN_FREQUENCIES,
  COACH_STRICTNESS,
  THRESHOLD_KEYS,
  THRESHOLDS,
} from "@openokr/method";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { archiveCycleInTx, feedForwardInTx } from "../cycles/archive.ts";
import {
  cyclePeriodFor,
  formatLocalDate,
  localDateIn,
  parseLocalDate,
} from "../cycles/generation.ts";
import {
  COLUMN_BACKED_THRESHOLDS,
  mergeOverrides,
  resolveRhythm,
  validateRhythmPatch,
} from "../cycles/rhythm.ts";
import {
  createCycleInTx,
  ensureCurrentCycleInTx,
  ensureRhythmSettingsInTx,
  findCurrentCycle,
  readRhythmRow,
  resolveWorkspaceCadence,
  workspaceTimeZone,
} from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const cycleOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  mode: z.enum(["annual", "quarterly"]),
  cadence: z.enum(CYCLE_CADENCES),
  startsOn: z.string(),
  endsOn: z.string(),
  status: z.enum(["planning", "active", "closing", "closed"]),
  phase: z.number().int().min(0).max(7),
  levels: z.array(z.enum(GOAL_LEVELS)),
  firstCycle: z.boolean(),
  publicationDeadline: z.string().nullable(),
  sponsorId: z.uuid().nullable(),
  facilitatorId: z.uuid().nullable(),
});

export type CycleOutput = z.infer<typeof cycleOutput>;

/** Resolves the acting member, or refuses the way every other read does. */
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

const toCycleOutput = (row: {
  id: string;
  name: string;
  mode: "annual" | "quarterly";
  cadence: (typeof CYCLE_CADENCES)[number];
  startsOn: string;
  endsOn: string;
  status: "planning" | "active" | "closing" | "closed";
  phase: number;
  levels: unknown;
  firstCycle: boolean;
  publicationDeadline: string | null;
  sponsorId: string | null;
  facilitatorId: string | null;
}): CycleOutput => ({
  id: row.id,
  name: row.name,
  mode: row.mode,
  cadence: row.cadence,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  status: row.status,
  phase: row.phase,
  levels: (Array.isArray(row.levels)
    ? row.levels
    : []) as CycleOutput["levels"],
  firstCycle: row.firstCycle,
  publicationDeadline: row.publicationDeadline,
  sponsorId: row.sponsorId,
  facilitatorId: row.facilitatorId,
});

const CYCLE_COLUMNS = {
  id: cycles.id,
  name: cycles.name,
  mode: cycles.mode,
  cadence: cycles.cadence,
  startsOn: cycles.startsOn,
  endsOn: cycles.endsOn,
  status: cycles.status,
  phase: cycles.phase,
  levels: cycles.levels,
  firstCycle: cycles.firstCycle,
  publicationDeadline: cycles.publicationDeadline,
  sponsorId: cycles.sponsorId,
  facilitatorId: cycles.facilitatorId,
} as const;

export const listCycles = defineReadAction({
  name: "cycles.list",
  summary: "Every cycle this workspace has, newest first.",
  input: z.object({}),
  output: z.array(cycleOutput),
  access: ACCESS_LEVELS.view,
  async handler(context): Promise<CycleOutput[]> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // A cycle belongs to the workspace, so the workspace's own context is
        // what authorises reading its list. Cycles hold no context of their own:
        // TECHNICAL-PLAN §4.1 lists the protected aggregates and a cycle is one
        // of them, but the visibility question a cycle actually poses is "may
        // you see this workspace", and per-cycle bindings would answer a question
        // nobody asks.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const rows = await tx
          .select(CYCLE_COLUMNS)
          .from(cycles)
          .where(
            activeOnly(cycles, eq(cycles.workspaceId, context.workspaceId)),
          )
          .orderBy(desc(cycles.startsOn));
        return rows.map(toCycleOutput);
      },
    );
  },
});

export const readCurrentCycle = defineReadAction({
  name: "cycles.current",
  summary:
    "The cycle to show: the one containing today, else the soonest ahead, else the most recent behind.",
  input: z.object({
    mode: z.enum(["annual", "quarterly"]).default("quarterly"),
  }),
  output: cycleOutput.nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<CycleOutput | null> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const timeZone = await workspaceTimeZone(
          tx as OperationTx,
          context.workspaceId,
        );
        const today = formatLocalDate(localDateIn(new Date(), timeZone));
        const found = await findCurrentCycle(
          tx as OperationTx,
          context.workspaceId,
          today,
          input.mode,
        );
        if (!found) {
          return null;
        }
        const [row] = await tx
          .select(CYCLE_COLUMNS)
          .from(cycles)
          .where(activeOnly(cycles, eq(cycles.id, found.id)))
          .limit(1);
        return row ? toCycleOutput(row) : null;
      },
    );
  },
});

export const ensureCurrentCycle = defineWriteAction({
  name: "cycles.ensureCurrent",
  summary:
    "Creates the cycle containing today if the workspace has none. Idempotent.",
  input: z.object({}),
  output: cycleOutput.extend({ created: z.boolean() }),
  // Any human member may bring the current cycle into being. Refusing an
  // ordinary member would mean a workspace whose admin is on holiday cannot
  // check in, and the row it creates is one every surface needs.
  access: ACCESS_LEVELS.edit,
  operation: () => ({
    async execute({ tx, workspaceId }) {
      const timeZone = await workspaceTimeZone(tx, workspaceId);
      const ensured = await ensureCurrentCycleInTx(tx, {
        workspaceId,
        timeZone,
        now: new Date(),
      });
      const [row] = await tx
        .select(CYCLE_COLUMNS)
        .from(cycles)
        .where(activeOnly(cycles, eq(cycles.id, ensured.id)))
        .limit(1);
      if (!row) {
        throw new Error("The ensured cycle could not be read back.");
      }
      return {
        result: { ...toCycleOutput(row), created: ensured.created },
        activity: {
          kind: ensured.created ? "cycle.created" : "cycle.resolved",
          subjectType: "cycle",
          subjectId: ensured.id,
          payload: { name: ensured.name },
        },
        audit: {
          action: "cycles.ensureCurrent",
          targetType: "cycle",
          targetId: ensured.id,
          payload: { name: ensured.name, created: ensured.created },
        },
      };
    },
  }),
});

export const createCycle = defineWriteAction({
  name: "cycles.create",
  summary: "Creates a named cycle for the period containing a chosen date.",
  input: z.object({
    /** A date inside the period to create, not the period's own start. */
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cadence: z.enum(CYCLE_CADENCES).optional(),
    firstCycle: z.boolean().default(false),
    sponsorId: z.uuid().nullable().optional(),
    facilitatorId: z.uuid().nullable().optional(),
    publicationDeadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  }),
  output: cycleOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const cadence =
        input.cadence ?? (await resolveWorkspaceCadence(tx, workspaceId));
      const period = cyclePeriodFor(cadence, parseLocalDate(input.on));
      const timeZone = await workspaceTimeZone(tx, workspaceId);
      const created = await createCycleInTx(tx, {
        workspaceId,
        cadence,
        period,
        today: formatLocalDate(localDateIn(new Date(), timeZone)),
        firstCycle: input.firstCycle,
        sponsorId: input.sponsorId ?? null,
        facilitatorId: input.facilitatorId ?? null,
        publicationDeadline: input.publicationDeadline ?? null,
      });
      const [row] = await tx
        .select(CYCLE_COLUMNS)
        .from(cycles)
        .where(activeOnly(cycles, eq(cycles.id, created.id)))
        .limit(1);
      if (!row) {
        throw new Error("The created cycle could not be read back.");
      }
      return {
        result: toCycleOutput(row),
        activity: {
          kind: "cycle.created",
          subjectType: "cycle",
          subjectId: created.id,
          payload: { name: created.name },
        },
        audit: {
          action: "cycles.create",
          targetType: "cycle",
          targetId: created.id,
          payload: {
            name: created.name,
            startsOn: created.startsOn,
            endsOn: created.endsOn,
          },
        },
      };
    },
  }),
});

export const updateCycle = defineWriteAction({
  name: "cycles.update",
  summary:
    "Sets a cycle's roles, phase, levels, session dates or publication deadline.",
  input: z.object({
    id: z.uuid(),
    phase: z.number().int().min(0).max(7).optional(),
    sponsorId: z.uuid().nullable().optional(),
    facilitatorId: z.uuid().nullable().optional(),
    publicationDeadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    levels: z.array(z.enum(GOAL_LEVELS)).min(1).optional(),
    contributingUnits: z.string().max(2000).nullable().optional(),
    firstCycle: z.boolean().optional(),
    sessionDates: z
      .array(z.object({ key: z.string().min(1), on: z.string() }))
      .optional(),
  }),
  output: cycleOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select(CYCLE_COLUMNS)
        .from(cycles)
        .where(
          activeOnly(
            cycles,
            eq(cycles.id, input.id),
            eq(cycles.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such cycle.");
      }
      if (existing.status === "closed") {
        throw new OperationError(
          "forbidden",
          "This cycle is closed. Its record does not change after the archive.",
        );
      }
      if (
        input.publicationDeadline &&
        input.publicationDeadline >= existing.startsOn
      ) {
        throw new OperationError(
          "forbidden",
          "The publication deadline falls on or after the cycle starts. Publish before day one.",
        );
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of [
        "phase",
        "sponsorId",
        "facilitatorId",
        "publicationDeadline",
        "levels",
        "contributingUnits",
        "firstCycle",
        "sessionDates",
      ] as const) {
        if (input[key] !== undefined) {
          patch[key] = input[key];
        }
      }

      const [updated] = await tx
        .update(cycles)
        .set(patch)
        .where(activeOnly(cycles, eq(cycles.id, input.id)))
        .returning(CYCLE_COLUMNS);
      if (!updated) {
        throw new OperationError("not_found", "No such cycle.");
      }

      return {
        result: toCycleOutput(updated),
        activity: {
          kind: "cycle.updated",
          subjectType: "cycle",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "cycles.update",
          targetType: "cycle",
          targetId: updated.id,
          payload: { name: updated.name, fields: Object.keys(patch) },
        },
      };
    },
  }),
});

export const archiveCycle = defineWriteAction({
  name: "cycles.archive",
  summary: "Archives a cycle. Its goals and scores stay readable.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [archived] = await tx
        .update(cycles)
        .set({ deletedAt: new Date() })
        .where(
          activeOnly(
            cycles,
            eq(cycles.id, input.id),
            eq(cycles.workspaceId, workspaceId),
          ),
        )
        .returning({ id: cycles.id, name: cycles.name });
      if (!archived) {
        throw new OperationError("not_found", "No such cycle.");
      }
      return {
        result: { id: archived.id },
        activity: {
          kind: "cycle.archived",
          subjectType: "cycle",
          subjectId: archived.id,
          payload: { name: archived.name },
        },
        audit: {
          action: "cycles.archive",
          targetType: "cycle",
          targetId: archived.id,
          payload: { name: archived.name },
        },
      };
    },
  }),
});

// --- The rhythm registry ---------------------------------------------------

const thresholdDescriptor = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  section: z.string(),
  why: z.string(),
  /** True when this parameter has its own column rather than living in the map. */
  columnBacked: z.boolean(),
});

export const readRhythmSettings = defineReadAction({
  name: "rhythm.read",
  summary:
    "The METHOD.md §11 registry as this workspace resolves it, with its deviations and its terminology.",
  input: z.object({}),
  output: z.object({
    defaultCheckInFrequency: z.enum(CHECK_IN_FREQUENCIES),
    checkInAnchorDay: z.number().int().min(1).max(7),
    coachStrictness: z.enum(COACH_STRICTNESS),
    /** Only the keys this workspace deviates on. */
    overrides: z.record(z.string(), z.unknown()),
    /** Every key, resolved: canon defaults with the deviations applied. */
    thresholds: z.record(z.string(), z.unknown()),
    terminology: z.record(z.string(), z.unknown()),
    registry: z.array(thresholdDescriptor),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // View, not full: every member reads the thresholds their own goals are
        // judged against. Changing them needs `manage_coaching`, which is the
        // `full` on `rhythm.update` below.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const row = await readRhythmRow(tx as OperationTx, context.workspaceId);
        const resolved = resolveRhythm(row);
        return {
          defaultCheckInFrequency: row?.defaultCheckInFrequency ?? "weekly",
          checkInAnchorDay: row?.checkInAnchorDay ?? 1,
          coachStrictness: row?.coachStrictness ?? "warn",
          overrides: (row?.overrides ?? {}) as Record<string, unknown>,
          thresholds: resolved.thresholds as unknown as Record<string, unknown>,
          terminology: resolved.terminology as unknown as Record<
            string,
            unknown
          >,
          registry: THRESHOLD_KEYS.map((key) => ({
            key,
            group: THRESHOLDS[key].group,
            label: THRESHOLDS[key].label,
            section: THRESHOLDS[key].section,
            why: THRESHOLDS[key].why,
            columnBacked: (
              COLUMN_BACKED_THRESHOLDS as readonly string[]
            ).includes(key),
          })),
        };
      },
    );
  },
});

export const updateRhythmSettings = defineWriteAction({
  name: "rhythm.update",
  summary:
    "Changes this workspace's deviations from the §11 canon, or its terminology.",
  input: z.object({
    defaultCheckInFrequency: z.enum(CHECK_IN_FREQUENCIES).optional(),
    checkInAnchorDay: z.number().int().min(1).max(7).optional(),
    coachStrictness: z.enum(COACH_STRICTNESS).optional(),
    /** Sparse. A key set to null returns that threshold to the canon default. */
    overrides: z.record(z.string(), z.unknown()).optional(),
    labels: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    overrides: z.record(z.string(), z.unknown()),
    thresholds: z.record(z.string(), z.unknown()),
    terminology: z.record(z.string(), z.unknown()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const { patch, problems } = validateRhythmPatch(input);
      if (problems.length > 0) {
        throw new OperationError(
          "forbidden",
          problems
            .map((problem) =>
              problem.key
                ? `${problem.key}: ${problem.message}`
                : problem.message,
            )
            .join(" "),
        );
      }

      await ensureRhythmSettingsInTx(tx, workspaceId);
      const stored = await readRhythmRow(tx, workspaceId);

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.defaultCheckInFrequency !== undefined) {
        values.defaultCheckInFrequency = patch.defaultCheckInFrequency;
      }
      if (patch.checkInAnchorDay !== undefined) {
        values.checkInAnchorDay = patch.checkInAnchorDay;
      }
      if (patch.coachStrictness !== undefined) {
        values.coachStrictness = patch.coachStrictness;
      }
      if (patch.overrides !== undefined) {
        values.overrides = mergeOverrides(
          (stored?.overrides ?? {}) as Record<string, unknown>,
          patch.overrides,
        );
      }
      if (patch.labels !== undefined) {
        values.labels = mergeOverrides(
          (stored?.labels ?? {}) as Record<string, unknown>,
          patch.labels,
        );
      }

      const [updated] = await tx
        .update(rhythmSettings)
        .set(values)
        .where(eq(rhythmSettings.workspaceId, workspaceId))
        .returning();
      if (!updated) {
        throw new Error("The rhythm settings row could not be updated.");
      }

      const resolved = resolveRhythm(updated);
      return {
        result: {
          overrides: updated.overrides as Record<string, unknown>,
          thresholds: resolved.thresholds as unknown as Record<string, unknown>,
          terminology: resolved.terminology as unknown as Record<
            string,
            unknown
          >,
        },
        activity: {
          kind: "rhythm.updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            keys: Object.keys(values).filter((k) => k !== "updatedAt"),
          },
        },
        audit: {
          action: "rhythm.update",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            keys: Object.keys(values).filter((key) => key !== "updatedAt"),
            overrides: updated.overrides,
          },
        },
      };
    },
  }),
});

// --- The annual frame -----------------------------------------------------

const frameOutput = z.object({
  id: z.uuid(),
  yearLabel: z.string(),
  horizonLabel: z.string().nullable(),
  agreed: z.boolean(),
  strategies: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      note: z.string().nullable(),
      position: z.number().int(),
    }),
  ),
});

export const readAnnualFrame = defineReadAction({
  name: "frame.read",
  summary: "The current annual frame and its strategic thrusts.",
  input: z.object({}),
  output: frameOutput.nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const [frame] = await tx
          .select({
            id: annualFrames.id,
            yearLabel: annualFrames.yearLabel,
            horizonLabel: annualFrames.horizonLabel,
            agreed: annualFrames.agreed,
          })
          .from(annualFrames)
          .where(
            activeOnly(
              annualFrames,
              eq(annualFrames.workspaceId, context.workspaceId),
              isNull(annualFrames.supersededAt),
            ),
          )
          .limit(1);
        if (!frame) {
          return null;
        }

        const strategies = await tx
          .select({
            id: annualStrategies.id,
            text: annualStrategies.text,
            note: annualStrategies.note,
            position: annualStrategies.position,
          })
          .from(annualStrategies)
          .where(
            activeOnly(
              annualStrategies,
              eq(annualStrategies.workspaceId, context.workspaceId),
              eq(annualStrategies.frameId, frame.id),
            ),
          )
          .orderBy(asc(annualStrategies.position));

        return { ...frame, strategies };
      },
    );
  },
});

export const setAnnualFrame = defineWriteAction({
  name: "frame.set",
  summary:
    "Creates or replaces the current annual frame. A replacement supersedes rather than edits.",
  input: z.object({
    yearLabel: z.string().trim().min(1).max(40),
    horizonLabel: z.string().trim().max(80).nullable().optional(),
    agreed: z.boolean().default(false),
    /** Replaces the whole list, which is how a two-to-five set is edited. */
    strategies: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(280),
          note: z.string().trim().max(1000).nullable().optional(),
        }),
      )
      .max(20)
      .default([]),
  }),
  output: frameOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [current] = await tx
        .select({ id: annualFrames.id, yearLabel: annualFrames.yearLabel })
        .from(annualFrames)
        .where(
          activeOnly(
            annualFrames,
            eq(annualFrames.workspaceId, workspaceId),
            isNull(annualFrames.supersededAt),
          ),
        )
        .limit(1);

      // METHOD.md §2.1: the frame is "never rewritten mid-year". A new year
      // supersedes; the same year's frame is edited in place, because recording
      // a correction as a supersession would make history unreadable.
      let frameId = current?.id;
      if (current && current.yearLabel !== input.yearLabel) {
        await tx
          .update(annualFrames)
          .set({ supersededAt: new Date() })
          .where(activeOnly(annualFrames, eq(annualFrames.id, current.id)));
        frameId = undefined;
      }

      if (frameId) {
        await tx
          .update(annualFrames)
          .set({
            horizonLabel: input.horizonLabel ?? null,
            agreed: input.agreed,
            updatedAt: new Date(),
          })
          .where(activeOnly(annualFrames, eq(annualFrames.id, frameId)));
      } else {
        const [inserted] = await tx
          .insert(annualFrames)
          .values({
            workspaceId,
            yearLabel: input.yearLabel,
            horizonLabel: input.horizonLabel ?? null,
            agreed: input.agreed,
          })
          .returning({ id: annualFrames.id });
        if (!inserted) {
          throw new Error("The annual frame insert returned no row.");
        }
        frameId = inserted.id;
      }

      // The strategy list is replaced wholesale. Soft-deleting the old rows
      // rather than updating them keeps "what the year's thrusts were in March"
      // answerable after they change in June.
      await tx
        .update(annualStrategies)
        .set({ deletedAt: new Date() })
        .where(
          activeOnly(
            annualStrategies,
            eq(annualStrategies.workspaceId, workspaceId),
            eq(annualStrategies.frameId, frameId),
          ),
        );

      for (const [index, strategy] of input.strategies.entries()) {
        await tx.insert(annualStrategies).values({
          workspaceId,
          frameId,
          text: strategy.text,
          note: strategy.note ?? null,
          position: index,
        });
      }

      const strategies = await tx
        .select({
          id: annualStrategies.id,
          text: annualStrategies.text,
          note: annualStrategies.note,
          position: annualStrategies.position,
        })
        .from(annualStrategies)
        .where(
          activeOnly(
            annualStrategies,
            eq(annualStrategies.frameId, frameId),
            eq(annualStrategies.workspaceId, workspaceId),
          ),
        )
        .orderBy(asc(annualStrategies.position));

      return {
        result: {
          id: frameId,
          yearLabel: input.yearLabel,
          horizonLabel: input.horizonLabel ?? null,
          agreed: input.agreed,
          strategies,
        },
        activity: {
          kind: "frame.set",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { yearLabel: input.yearLabel },
        },
        audit: {
          action: "frame.set",
          targetType: "annual_frame",
          targetId: frameId,
          payload: {
            yearLabel: input.yearLabel,
            strategies: input.strategies.length,
            superseded: Boolean(
              current && current.yearLabel !== input.yearLabel,
            ),
          },
        },
      };
    },
  }),
});

/**
 * Not `cycles.archive`: that name is taken, and it means something else. The
 * action above soft-deletes a cycle. This one records what the cycle achieved,
 * which METHOD.md §8.9 calls archiving and the plan calls the archive job. Two
 * different acts cannot share one verb, so the newer one is named for what it
 * writes.
 */
export const snapshotCycle = defineWriteAction({
  name: "cycles.snapshot",
  summary:
    "Records what a cycle achieved: the result, the band counts and the portfolio verdict, one snapshot per owner.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    snapshots: z.number().int(),
    resultValue: z.number().nullable(),
    verdict: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const result = await archiveCycleInTx(
        tx,
        workspaceId,
        input.cycleId,
        rhythm.thresholds,
      );
      return {
        result,
        activity: {
          kind: "cycle.snapshotted" as const,
          subjectType: "cycle" as const,
          subjectId: input.cycleId,
          payload: {
            snapshots: result.snapshots,
            verdict: result.verdict,
          },
        },
        audit: {
          action: "cycles.archive",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { snapshots: result.snapshots },
        },
      };
    },
  }),
});

export const readScorecard = defineReadAction({
  name: "cycles.scorecard",
  summary:
    "Every archived cycle's result with its band counts and verdict, oldest first. Drives the scorecard.",
  input: z.object({}),
  output: z.object({
    rows: z.array(
      z.object({
        cycleId: z.uuid(),
        cycleName: z.string(),
        startsOn: z.string(),
        resultValue: z.number().nullable(),
        verdict: z.string().nullable(),
        fullyAchieved: z.number().int(),
        strong: z.number().int(),
        partial: z.number().int(),
        little: z.number().int(),
      }),
    ),
    pointsEnabled: z.boolean(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // The workspace scope only. A space or a member reads their own trend
        // from their own page; a scorecard that mixed the three would add
        // numbers that answer different questions.
        const rows = await tx
          .select({
            cycleId: performanceSnapshots.cycleId,
            cycleName: cycles.name,
            startsOn: cycles.startsOn,
            resultValue: performanceSnapshots.resultValue,
            verdict: performanceSnapshots.verdict,
            fullyAchieved: performanceSnapshots.fullyAchievedCount,
            strong: performanceSnapshots.strongCount,
            partial: performanceSnapshots.partialCount,
            little: performanceSnapshots.littleCount,
          })
          .from(performanceSnapshots)
          .innerJoin(cycles, eq(cycles.id, performanceSnapshots.cycleId))
          .where(
            activeOnly(
              performanceSnapshots,
              eq(performanceSnapshots.workspaceId, context.workspaceId),
              eq(performanceSnapshots.ownerKind, "workspace"),
            ),
          )
          .orderBy(asc(cycles.startsOn));

        const [settings] = await tx
          .select({ enabled: scorecardSettings.enabled })
          .from(scorecardSettings)
          .where(
            activeOnly(
              scorecardSettings,
              eq(scorecardSettings.workspaceId, context.workspaceId),
            ),
          )
          .limit(1);

        return {
          rows: rows.map((row) => ({
            ...row,
            resultValue:
              row.resultValue === null ? null : Number(row.resultValue),
          })),
          // No row means off, which is the default and needs no row to say so.
          pointsEnabled: settings?.enabled ?? false,
        };
      },
    );
  },
});

export const feedForwardCycle = defineWriteAction({
  name: "cycles.feedForward",
  summary:
    "Hands METHOD.md §8.9's inheritance to the next cycle: prior scores, carried work as issues at impact four, and the annual frame.",
  input: z.object({ fromCycleId: z.uuid(), toCycleId: z.uuid() }),
  output: z.object({
    priorScores: z.number().int(),
    issues: z.number().int(),
    frameCarried: z.boolean(),
    /** Rows of the mapping this build cannot fill, each naming its task. Empty since P4-T12-b. */
    waiting: z.array(z.string()),
    /** Whether the lowest process-health statement became an issue. */
    processHealthIssue: z.boolean(),
    /** Whether the learnings reached the next cycle's input pack. */
    packNote: z.boolean(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const result = await feedForwardInTx(
        tx,
        workspaceId,
        input.fromCycleId,
        input.toCycleId,
      );
      return {
        result: { ...result, waiting: [...result.waiting] },
        activity: {
          kind: "cycle.fed_forward" as const,
          subjectType: "cycle" as const,
          subjectId: input.toCycleId,
          payload: {
            priorScores: result.priorScores,
            issues: result.issues,
          },
        },
        audit: {
          action: "cycles.feedForward",
          targetType: "cycle",
          targetId: input.toCycleId,
          payload: {
            from: input.fromCycleId,
            priorScores: result.priorScores,
            issues: result.issues,
          },
        },
      };
    },
  }),
});
