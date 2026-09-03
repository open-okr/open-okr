/**
 * Initiative reads and writes (TECHNICAL-PLAN §4.9, METHOD.md §5.5, P5-T10a).
 *
 * **An initiative is work, and work does not move a number by itself.** Nothing
 * here writes a key result's value, progress or health, and nothing reads a
 * completed initiative as evidence that a measure moved. The work-layer design's
 * §1 is the whole reason: a product that let a finished project turn a key result
 * green would be teaching teams to measure activity instead of outcomes.
 *
 * **`progress_pct` accepts no input.** The design's answer to W2 is that an
 * initiative's progress is the share of its own tasks that are done, and tasks
 * arrive at P5-T11. Until then the column reads zero for everybody, which is
 * honest. A typed percentage would be a number that goes stale in a week and
 * nothing would notice.
 *
 * **Capacity is the one field that reaches the method.** Publish gate five reads
 * it beside the per-key-result verdicts (METHOD.md §4.5, §5.5), so setting an
 * initiative to `exceeds` turns the gate red and names the initiative. That is
 * §5.5 implemented, not extended: the section already asks for the initiatives
 * and the verdict in one sentence.
 */
import {
  activeOnly,
  CAPACITY_VERDICTS,
  goals,
  INITIATIVE_STATUSES,
  initiativeKeyResults,
  initiatives,
  keyResults,
  spaces,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { refreshGateStateFor } from "../cycles/workflow.ts";
import { assertLegacyKeyFree, legacyKey } from "../imports/legacy.ts";
import {
  asNumber,
  createInitiativeInTx,
  linkKeyResultInTx,
  reassignInitiativeOwnerInTx,
  unlinkKeyResultInTx,
} from "../initiatives/service.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const richText = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const initiativeOutput = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  spaceName: z.string(),
  title: z.string(),
  ownerId: z.uuid(),
  ownerName: z.string(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  status: z.enum(INITIATIVE_STATUSES),
  confidence: z.number().nullable(),
  capacity: z.enum(CAPACITY_VERDICTS).nullable(),
  /** Derived from the initiative's own tasks at P5-T11. Zero until then. */
  progressPct: z.number(),
  keyResultIds: z.array(z.uuid()),
});

/** A write reached by something with no member row cannot own or edit work. */
function requireMemberId(memberId: string | null | undefined): string {
  if (!memberId) {
    throw new OperationError("forbidden", "A system actor cannot do this.");
  }
  return memberId;
}

/**
 * The acting member, or not-found.
 *
 * The fourth copy of the same fifteen lines, and it is local for the reason
 * `actions/copilot.ts` records: extracting it means editing files this task has
 * no other reason to touch. The extraction is on the P4-T14a-a row.
 */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such initiative.");
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
    throw new OperationError("not_found", "No such initiative.");
  }
  return member.id;
}

/** The initiative's row and the level this member holds on it, or not-found. */
async function requireInitiative(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  initiativeId: string,
  requires: number,
): Promise<{
  readonly contextId: string;
  readonly spaceId: string;
  readonly ownerId: string;
  readonly title: string;
}> {
  const scoped = await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "initiative",
    resourceId: initiativeId,
    requires: requires as never,
  });
  const [row] = await tx
    .select({
      spaceId: initiatives.spaceId,
      ownerId: initiatives.ownerId,
      title: initiatives.title,
    })
    .from(initiatives)
    .where(
      activeOnly(
        initiatives,
        eq(initiatives.workspaceId, workspaceId),
        eq(initiatives.id, initiativeId),
      ),
    )
    .limit(1);
  if (!row) {
    // The context outlived the row, which a soft delete does. Same sentence.
    throw new OperationError(
      "not_found",
      "No such initiative, or you do not have access to it.",
    );
  }
  return {
    contextId: scoped.contextId,
    spaceId: row.spaceId,
    ownerId: row.ownerId,
    title: row.title,
  };
}

/** Every cycle this initiative's key results belong to, so gate five follows. */
async function cyclesBehind(
  tx: OperationTx,
  workspaceId: string,
  initiativeId: string,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ cycleId: goals.cycleId })
    .from(initiativeKeyResults)
    .innerJoin(
      keyResults,
      and(
        eq(keyResults.id, initiativeKeyResults.keyResultId),
        eq(keyResults.workspaceId, workspaceId),
        isNull(keyResults.deletedAt),
      ),
    )
    .innerJoin(
      goals,
      and(
        eq(goals.id, keyResults.goalId),
        eq(goals.workspaceId, workspaceId),
        isNull(goals.deletedAt),
      ),
    )
    .where(
      activeOnly(
        initiativeKeyResults,
        eq(initiativeKeyResults.workspaceId, workspaceId),
        eq(initiativeKeyResults.initiativeId, initiativeId),
      ),
    );
  return rows
    .map((row) => row.cycleId)
    .filter((cycleId): cycleId is string => cycleId !== null);
}

/**
 * Recomputes gate five wherever this initiative is counted.
 *
 * **In the same transaction as the change that caused it**, so the stored gate
 * row and the initiative can never disagree. `cycle_gate_state` is a cache of an
 * evaluation and `publishCycle` re-evaluates anyway, but a cache that is wrong
 * between two writes is a cache a facilitator reads.
 */
async function recomputeGatesBehind(
  tx: OperationTx,
  workspaceId: string,
  cycleIds: readonly string[],
): Promise<void> {
  if (cycleIds.length === 0) {
    return;
  }
  // Read once for the whole set. The thresholds are a workspace setting, so
  // resolving them per cycle would be the same answer fetched four times.
  const { thresholds } = resolveRhythm(await readRhythmRow(tx, workspaceId));
  for (const cycleId of cycleIds) {
    await refreshGateStateFor(tx, workspaceId, cycleId, thresholds);
  }
}

/** Rows plus their linked key results, in one extra query rather than N. */
async function withLinks(
  tx: OperationTx,
  workspaceId: string,
  rows: readonly {
    id: string;
    spaceId: string;
    spaceName: string;
    title: string;
    ownerId: string;
    ownerName: string;
    startsOn: string | null;
    endsOn: string | null;
    status: (typeof INITIATIVE_STATUSES)[number];
    confidence: string | null;
    capacity: (typeof CAPACITY_VERDICTS)[number] | null;
    progressPct: string;
  }[],
) {
  if (rows.length === 0) {
    return [];
  }
  const links = await tx
    .select({
      initiativeId: initiativeKeyResults.initiativeId,
      keyResultId: initiativeKeyResults.keyResultId,
    })
    .from(initiativeKeyResults)
    .where(
      activeOnly(
        initiativeKeyResults,
        eq(initiativeKeyResults.workspaceId, workspaceId),
        inArray(
          initiativeKeyResults.initiativeId,
          rows.map((row) => row.id),
        ),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    spaceId: row.spaceId,
    spaceName: row.spaceName,
    title: row.title,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    confidence: asNumber(row.confidence),
    capacity: row.capacity,
    progressPct: asNumber(row.progressPct) ?? 0,
    keyResultIds: links
      .filter((link) => link.initiativeId === row.id)
      .map((link) => link.keyResultId),
  }));
}

const LIST_COLUMNS = {
  id: initiatives.id,
  spaceId: initiatives.spaceId,
  spaceName: spaces.name,
  title: initiatives.title,
  ownerId: initiatives.ownerId,
  ownerName: workspaceMembers.name,
  startsOn: initiatives.startsOn,
  endsOn: initiatives.endsOn,
  status: initiatives.status,
  confidence: initiatives.confidence,
  capacity: initiatives.capacity,
  progressPct: initiatives.progressPct,
};

export const listInitiatives = defineReadAction({
  name: "initiatives.list",
  summary:
    "Initiatives in a space, or the ones serving one key result. Drives screen S-26.",
  input: z.object({
    spaceId: z.uuid().optional(),
    keyResultId: z.uuid().optional(),
    status: z.enum(INITIATIVE_STATUSES).optional(),
    capacity: z.enum(CAPACITY_VERDICTS).optional(),
  }),
  output: z.array(initiativeOutput),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);

        // Filtering by key result first, because the §5.5 reading is "which
        // initiatives will move this number" and that is a join, not a scan.
        let ids: string[] | null = null;
        if (input.keyResultId) {
          const links = await tx
            .select({ initiativeId: initiativeKeyResults.initiativeId })
            .from(initiativeKeyResults)
            .where(
              activeOnly(
                initiativeKeyResults,
                eq(initiativeKeyResults.workspaceId, context.workspaceId),
                eq(initiativeKeyResults.keyResultId, input.keyResultId),
              ),
            );
          ids = links.map((link) => link.initiativeId);
          if (ids.length === 0) {
            return [];
          }
        }

        const rows = await tx
          .select(LIST_COLUMNS)
          .from(initiatives)
          .innerJoin(spaces, eq(spaces.id, initiatives.spaceId))
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, initiatives.ownerId),
          )
          .where(
            activeOnly(
              initiatives,
              eq(initiatives.workspaceId, context.workspaceId),
              ...(input.spaceId
                ? [eq(initiatives.spaceId, input.spaceId)]
                : []),
              ...(input.status ? [eq(initiatives.status, input.status)] : []),
              ...(input.capacity
                ? [eq(initiatives.capacity, input.capacity)]
                : []),
              ...(ids ? [inArray(initiatives.id, ids)] : []),
            ),
          )
          .orderBy(asc(initiatives.position), asc(initiatives.title));

        // Every row is put to the access getter rather than filtered by a
        // context column, which is the same shape every other list read here
        // uses. A member who cannot see the initiative never sees the row.
        const readable: typeof rows = [];
        for (const row of rows) {
          const allowed = await getAccessScoped(tx, {
            workspaceId: context.workspaceId,
            memberId,
            resourceType: "initiative",
            resourceId: row.id,
          }).then(
            () => true,
            () => false,
          );
          if (allowed) {
            readable.push(row);
          }
        }
        return withLinks(tx, context.workspaceId, readable);
      },
    );
  },
});

export const readInitiative = defineReadAction({
  name: "initiatives.read",
  summary: "One initiative with the key results it serves.",
  input: z.object({ id: z.uuid() }),
  output: initiativeOutput,
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such initiative.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await requireInitiative(
          tx,
          context.workspaceId,
          memberId,
          input.id,
          ACCESS_LEVELS.view,
        );

        const rows = await tx
          .select(LIST_COLUMNS)
          .from(initiatives)
          .innerJoin(spaces, eq(spaces.id, initiatives.spaceId))
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, initiatives.ownerId),
          )
          .where(
            activeOnly(
              initiatives,
              eq(initiatives.workspaceId, context.workspaceId),
              eq(initiatives.id, input.id),
            ),
          )
          .limit(1);

        const [one] = await withLinks(tx, context.workspaceId, rows);
        if (!one) {
          throw new OperationError(
            "not_found",
            "No such initiative, or you do not have access to it.",
          );
        }
        return one;
      },
    );
  },
});

export const createInitiative = defineWriteAction({
  name: "initiatives.create",
  summary: "Creates an initiative in a space, owned by one member.",
  input: z.object({
    spaceId: z.uuid(),
    title: z.string().trim().min(1).max(500),
    description: richText.optional(),
    ownerId: z.uuid(),
    startsOn: z.string().optional(),
    endsOn: z.string().optional(),
    status: z.enum(INITIATIVE_STATUSES).optional(),
    confidence: z.number().min(0).max(1).optional(),
    capacity: z.enum(CAPACITY_VERDICTS).optional(),
    keyResultIds: z.array(z.uuid()).max(50).optional(),
    /** The source-system identity, when an import is creating this (P6-T01a). */
    legacy: legacyKey.optional(),
  }),
  output: z.object({ id: z.uuid(), title: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    // The space decides who may create work in it, which is the same rule a
    // goal owned by a space follows.
    async load({ tx, workspaceId, actor }) {
      await getAccessScoped(tx, {
        workspaceId,
        memberId: requireMemberId(actor.memberId),
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      return undefined;
    },
    async execute({ tx, workspaceId }) {
      await assertLegacyKeyFree(
        tx,
        workspaceId,
        initiatives,
        input.legacy,
        "initiative",
      );

      const created = await createInitiativeInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        title: input.title,
        description: input.description,
        ownerId: input.ownerId,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        ...(input.status ? { status: input.status } : {}),
        confidence: input.confidence ?? null,
        capacity: input.capacity ?? null,
        ...(input.legacy ? { legacy: input.legacy } : {}),
      });

      for (const keyResultId of input.keyResultIds ?? []) {
        await linkKeyResultInTx(tx, {
          workspaceId,
          initiativeId: created.id,
          keyResultId,
        });
      }
      await recomputeGatesBehind(
        tx,
        workspaceId,
        await cyclesBehind(tx, workspaceId, created.id),
      );

      return {
        result: { id: created.id, title: created.title },
        activity: {
          kind: "initiative.created",
          subjectType: "initiative",
          subjectId: created.id,
          payload: { title: created.title, spaceId: input.spaceId },
        },
        audit: {
          action: "initiatives.create",
          targetType: "initiative",
          targetId: created.id,
          payload: { title: created.title, spaceId: input.spaceId },
        },
      };
    },
  }),
});

export const updateInitiative = defineWriteAction({
  name: "initiatives.update",
  summary:
    "Updates an initiative's own fields. Progress is derived from its tasks and is not one of them.",
  input: z
    .object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      description: richText.optional(),
      ownerId: z.uuid().optional(),
      startsOn: z.string().nullable().optional(),
      endsOn: z.string().nullable().optional(),
      status: z.enum(INITIATIVE_STATUSES).optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      capacity: z.enum(CAPACITY_VERDICTS).nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 1, {
      message: "an update has to change something",
    }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireInitiative(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      if (input.ownerId && input.ownerId !== loaded.ownerId) {
        await reassignInitiativeOwnerInTx(tx, {
          workspaceId,
          initiativeId: input.id,
          contextId: loaded.contextId,
          fromMemberId: loaded.ownerId,
          toMemberId: input.ownerId,
        });
      }

      await tx
        .update(initiatives)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : {
                description: input.description as never,
                descriptionVersion:
                  input.description === null ? null : RICH_TEXT_SCHEMA_VERSION,
              }),
          ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
          ...(input.startsOn === undefined ? {} : { startsOn: input.startsOn }),
          ...(input.endsOn === undefined ? {} : { endsOn: input.endsOn }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.confidence === undefined
            ? {}
            : {
                confidence:
                  input.confidence === null ? null : String(input.confidence),
              }),
          ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            initiatives,
            eq(initiatives.workspaceId, workspaceId),
            eq(initiatives.id, input.id),
          ),
        );

      // Capacity is the field gate five reads, and it may have just moved.
      await recomputeGatesBehind(
        tx,
        workspaceId,
        await cyclesBehind(tx, workspaceId, input.id),
      );

      return {
        result: { id: input.id },
        activity: {
          kind: "initiative.updated",
          subjectType: "initiative",
          subjectId: input.id,
          payload: { fields: Object.keys(input).filter((key) => key !== "id") },
        },
        audit: {
          action: "initiatives.update",
          targetType: "initiative",
          targetId: input.id,
          payload: { fields: Object.keys(input).filter((key) => key !== "id") },
        },
      };
    },
  }),
});

export const linkInitiativeKeyResult = defineWriteAction({
  name: "initiatives.linkKeyResult",
  summary:
    "Records that this initiative is one of the ones that will move a key result (METHOD.md §5.5).",
  input: z.object({ id: z.uuid(), keyResultId: z.uuid() }),
  output: z.object({ linked: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireInitiative(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId, actor }) {
      // The key result's own goal decides too: linking work to a measure is a
      // statement about that measure, so the caller has to be able to edit it.
      const [keyResult] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.keyResultId),
          ),
        )
        .limit(1);
      if (!keyResult) {
        throw new OperationError("not_found", "No such key result.");
      }
      await getAccessScoped(tx, {
        workspaceId,
        memberId: requireMemberId(actor.memberId),
        resourceType: "goal",
        resourceId: keyResult.goalId,
        requires: ACCESS_LEVELS.edit,
      });

      const outcome = await linkKeyResultInTx(tx, {
        workspaceId,
        initiativeId: input.id,
        keyResultId: input.keyResultId,
      });
      await recomputeGatesBehind(
        tx,
        workspaceId,
        await cyclesBehind(tx, workspaceId, input.id),
      );

      return {
        result: outcome,
        activity: {
          kind: "initiative.linked",
          subjectType: "initiative",
          subjectId: input.id,
          payload: { keyResultId: input.keyResultId },
        },
        audit: {
          action: "initiatives.linkKeyResult",
          targetType: "initiative",
          targetId: input.id,
          payload: { keyResultId: input.keyResultId },
        },
      };
    },
  }),
});

export const unlinkInitiativeKeyResult = defineWriteAction({
  name: "initiatives.unlinkKeyResult",
  summary: "Removes the link between an initiative and a key result.",
  input: z.object({ id: z.uuid(), keyResultId: z.uuid() }),
  output: z.object({ unlinked: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireInitiative(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId }) {
      // The cycles are read before the link goes, because afterwards the join
      // that finds them no longer reaches the cycle this change affected.
      const affected = await cyclesBehind(tx, workspaceId, input.id);
      const outcome = await unlinkKeyResultInTx(tx, {
        workspaceId,
        initiativeId: input.id,
        keyResultId: input.keyResultId,
      });
      await recomputeGatesBehind(tx, workspaceId, affected);

      return {
        result: outcome,
        activity: {
          kind: "initiative.unlinked",
          subjectType: "initiative",
          subjectId: input.id,
          payload: { keyResultId: input.keyResultId },
        },
        audit: {
          action: "initiatives.unlinkKeyResult",
          targetType: "initiative",
          targetId: input.id,
          payload: { keyResultId: input.keyResultId },
        },
      };
    },
  }),
});

export const deleteInitiative = defineWriteAction({
  name: "initiatives.delete",
  summary: "Soft-deletes an initiative and the links it held.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireInitiative(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.full,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      const affected = await cyclesBehind(tx, workspaceId, input.id);
      const now = new Date();
      await tx
        .update(initiativeKeyResults)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            initiativeKeyResults,
            eq(initiativeKeyResults.workspaceId, workspaceId),
            eq(initiativeKeyResults.initiativeId, input.id),
          ),
        );
      await tx
        .update(initiatives)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            initiatives,
            eq(initiatives.workspaceId, workspaceId),
            eq(initiatives.id, input.id),
          ),
        );
      await recomputeGatesBehind(tx, workspaceId, affected);

      return {
        result: { id: input.id },
        activity: {
          kind: "initiative.deleted",
          subjectType: "initiative",
          subjectId: input.id,
          payload: { title: loaded.title },
        },
        audit: {
          action: "initiatives.delete",
          targetType: "initiative",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const readCapacity = defineReadAction({
  name: "initiatives.capacity",
  summary:
    "One cycle's capacity check: every key result's verdict and every initiative behind it (METHOD.md §5.5).",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    keyResults: z.array(
      z.object({
        id: z.uuid(),
        goalId: z.uuid(),
        goalTitle: z.string(),
        title: z.string(),
        capacity: z.enum(CAPACITY_VERDICTS).nullable(),
        initiativeIds: z.array(z.uuid()),
      }),
    ),
    initiatives: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        capacity: z.enum(CAPACITY_VERDICTS).nullable(),
      }),
    ),
    /** True when anything on this cycle still reads `exceeds`. Gate five. */
    exceeds: z.boolean(),
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

        const rows = await tx
          .select({
            id: keyResults.id,
            goalId: keyResults.goalId,
            goalTitle: goals.title,
            title: keyResults.title,
            capacity: keyResults.capacity,
          })
          .from(keyResults)
          .innerJoin(goals, eq(goals.id, keyResults.goalId))
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(goals.cycleId, input.cycleId),
              isNull(goals.deletedAt),
            ),
          )
          .orderBy(asc(goals.position), asc(keyResults.position));

        // Every key result is reached through its goal, which is the rule the
        // rest of the product follows: a key result inherits its goal's context,
        // so "no such key result" and "not yours to see" answer alike.
        const readable: typeof rows = [];
        for (const row of rows) {
          const allowed = await getAccessScoped(tx, {
            workspaceId: context.workspaceId,
            memberId,
            resourceType: "goal",
            resourceId: row.goalId,
          }).then(
            () => true,
            () => false,
          );
          if (allowed) {
            readable.push(row);
          }
        }

        if (readable.length === 0) {
          return { keyResults: [], initiatives: [], exceeds: false };
        }

        const links = await tx
          .select({
            initiativeId: initiativeKeyResults.initiativeId,
            keyResultId: initiativeKeyResults.keyResultId,
          })
          .from(initiativeKeyResults)
          .where(
            activeOnly(
              initiativeKeyResults,
              eq(initiativeKeyResults.workspaceId, context.workspaceId),
              inArray(
                initiativeKeyResults.keyResultId,
                readable.map((row) => row.id),
              ),
            ),
          );

        const initiativeIds = [
          ...new Set(links.map((link) => link.initiativeId)),
        ];
        const behind =
          initiativeIds.length === 0
            ? []
            : await tx
                .select({
                  id: initiatives.id,
                  title: initiatives.title,
                  capacity: initiatives.capacity,
                })
                .from(initiatives)
                .where(
                  activeOnly(
                    initiatives,
                    eq(initiatives.workspaceId, context.workspaceId),
                    inArray(initiatives.id, initiativeIds),
                  ),
                )
                .orderBy(asc(initiatives.title));

        return {
          keyResults: readable.map((row) => ({
            id: row.id,
            goalId: row.goalId,
            goalTitle: row.goalTitle,
            title: row.title,
            capacity: row.capacity,
            initiativeIds: links
              .filter((link) => link.keyResultId === row.id)
              .map((link) => link.initiativeId),
          })),
          initiatives: behind,
          exceeds:
            readable.some((row) => row.capacity === "exceeds") ||
            behind.some((row) => row.capacity === "exceeds"),
        };
      },
    );
  },
});
