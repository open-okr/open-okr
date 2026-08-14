/**
 * Alignment actions: the horizontal links, the dependency register, the score
 * and its findings (METHOD.md §5, TECHNICAL-PLAN §4.5 and §14, P3-T09).
 *
 * The dependency writes sit under the `goals` domain because that is where their
 * authorisation resolves: a dependency is a sub-resource of the goal or the key
 * result it hangs from, and §4.1 says sub-resources inherit. The score and its
 * findings are their own domain, because they belong to a scope and a cycle
 * rather than to any one goal.
 *
 * Two refusals here are rules rather than validation. A dependency between two
 * goals needs edit on **both**, because a link nobody on the other side can see
 * is not a dependency, it is an assumption. And only the providing side confirms
 * (§5.4): a depending team that could confirm its own dependency would turn the
 * register into a wish list.
 */
import {
  activeOnly,
  alignmentFindings,
  goalDependencies,
  goals,
  keyResultDependencies,
  keyResults,
  newId,
  spaces,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { alignmentHealthy, alignmentScore } from "@openokr/method";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import {
  blocksPublish,
  loadAlignmentGraph,
  loadDependencyRegister,
  recomputeAlignment,
  scopesForGoal,
} from "../alignment/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

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

async function requireGoal(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  goalId: string,
  requires: number,
) {
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "goal",
    resourceId: goalId,
    requires: requires as never,
  });
  const [goal] = await tx
    .select({
      id: goals.id,
      cycleId: goals.cycleId,
      spaceId: goals.spaceId,
      title: goals.title,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    )
    .limit(1);
  if (!goal) {
    throw new OperationError("not_found", "No such goal.");
  }
  return goal;
}

/** The key result's owning goal, which is where its authorisation lives. */
async function requireKeyResultGoal(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  keyResultId: string,
  requires: number,
) {
  const [row] = await tx
    .select({ goalId: keyResults.goalId })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(keyResults.id, keyResultId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new OperationError("not_found", "No such key result.");
  }
  return requireGoal(tx, workspaceId, memberId, row.goalId, requires);
}

/**
 * Recomputes every scope a set of goals touches (design §7).
 *
 * The one entry point for it, so a structural write added later cannot leave the
 * score stale. Progress and check-ins deliberately never reach here: METHOD.md
 * §5.2 measures structure, and a score that moved when a number moved would be
 * measuring something else.
 */
export async function recomputeAlignmentFor(
  tx: OperationTx,
  workspaceId: string,
  touched: readonly { cycleId: string | null; spaceId: string | null }[],
): Promise<void> {
  const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
  const penalties = rhythm.thresholds["alignment.penalties"];

  const done = new Set<string>();
  for (const goal of touched) {
    if (!goal.cycleId) {
      // A goal on a timeframe rather than a cycle is outside every alignment
      // scope, because §2 scopes the score to one cycle.
      continue;
    }
    for (const scope of scopesForGoal([goal.spaceId])) {
      const key = `${goal.cycleId}:${scope.kind}:${
        scope.kind === "space" ? scope.spaceId : ""
      }`;
      if (done.has(key)) {
        continue;
      }
      done.add(key);
      await recomputeAlignment(
        tx,
        { workspaceId, cycleId: goal.cycleId, scope },
        penalties,
      );
    }
  }
}

export const addGoalDependency = defineWriteAction({
  name: "goals.addDependency",
  summary:
    "Links two goals as depending on each other. Stored once; direction carries no meaning.",
  input: z.object({
    fromGoalId: z.uuid(),
    toGoalId: z.uuid(),
    note: z.string().trim().max(500).optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      if (input.fromGoalId === input.toGoalId) {
        throw new OperationError(
          "forbidden",
          "A goal cannot depend on itself. A dependency crosses a boundary, or it is not one.",
        );
      }
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      // Edit on both ends. A link the other side cannot see is an assumption,
      // not a dependency, and §5.1 calls the relationship two-way by meaning.
      const from = await requireGoal(
        tx,
        workspaceId,
        memberId,
        input.fromGoalId,
        ACCESS_LEVELS.edit,
      );
      const to = await requireGoal(
        tx,
        workspaceId,
        memberId,
        input.toGoalId,
        ACCESS_LEVELS.edit,
      );

      // Canonical order, so "already linked" is one unique index rather than two
      // queries and a race.
      const [first, second] =
        input.fromGoalId < input.toGoalId
          ? [input.fromGoalId, input.toGoalId]
          : [input.toGoalId, input.fromGoalId];

      const [existing] = await tx
        .select({ id: goalDependencies.id })
        .from(goalDependencies)
        .where(
          activeOnly(
            goalDependencies,
            eq(goalDependencies.workspaceId, workspaceId),
            eq(goalDependencies.fromGoalId, first),
            eq(goalDependencies.toGoalId, second),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          result: { id: existing.id },
          activity: {
            kind: "alignment.dependency_added" as const,
            subjectType: "goal" as const,
            subjectId: input.fromGoalId,
            payload: { note: false },
          },
          audit: {
            action: "goals.addDependency",
            targetType: "goal_dependency",
            targetId: existing.id,
            payload: { repeat: true },
          },
        };
      }

      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(goalDependencies).values({
        id,
        workspaceId,
        fromGoalId: first,
        toGoalId: second,
        note: input.note ?? null,
        createdById: memberId,
      });

      await recomputeAlignmentFor(tx, workspaceId, [from, to]);

      return {
        result: { id },
        activity: {
          kind: "alignment.dependency_added" as const,
          subjectType: "goal" as const,
          subjectId: input.fromGoalId,
          payload: { note: Boolean(input.note) },
        },
        audit: {
          action: "goals.addDependency",
          targetType: "goal_dependency",
          targetId: id,
          payload: { from: first, to: second },
        },
      };
    },
  }),
});

export const removeGoalDependency = defineWriteAction({
  name: "goals.removeDependency",
  summary: "Removes a horizontal link between two goals.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({
          id: goalDependencies.id,
          fromGoalId: goalDependencies.fromGoalId,
          toGoalId: goalDependencies.toGoalId,
        })
        .from(goalDependencies)
        .where(
          activeOnly(
            goalDependencies,
            eq(goalDependencies.workspaceId, workspaceId),
            eq(goalDependencies.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such dependency.");
      }
      // Either end may remove it. Both agreed to it; either can say it is over.
      const from = await requireGoal(
        tx,
        workspaceId,
        memberId,
        row.fromGoalId,
        ACCESS_LEVELS.view,
      ).catch(() => null);
      const to = await requireGoal(
        tx,
        workspaceId,
        memberId,
        row.toGoalId,
        ACCESS_LEVELS.view,
      ).catch(() => null);
      // Sequential, not `Promise.all`: both checks read through the same
      // transaction, which is one connection, and two queries started on it at
      // once queue inside the driver today and throw under `pg` 9.
      const fromEditable = await requireGoal(
        tx,
        workspaceId,
        memberId,
        row.fromGoalId,
        ACCESS_LEVELS.edit,
      )
        .then(() => true)
        .catch(() => false);
      const toEditable = await requireGoal(
        tx,
        workspaceId,
        memberId,
        row.toGoalId,
        ACCESS_LEVELS.edit,
      )
        .then(() => true)
        .catch(() => false);
      if (!fromEditable && !toEditable) {
        throw new OperationError("not_found", "No such dependency.");
      }

      const now = new Date();
      // openokr:allow-mutation: same transaction.
      await tx
        .update(goalDependencies)
        .set({ deletedAt: now, updatedAt: now })
        .where(activeOnly(goalDependencies, eq(goalDependencies.id, input.id)));

      await recomputeAlignmentFor(
        tx,
        workspaceId,
        [from, to].filter((goal) => goal !== null),
      );

      return {
        result: { id: input.id },
        activity: {
          kind: "alignment.dependency_removed" as const,
          subjectType: "goal" as const,
          subjectId: row.fromGoalId,
          payload: {},
        },
        audit: {
          action: "goals.removeDependency",
          targetType: "goal_dependency",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const addKeyResultDependency = defineWriteAction({
  name: "goals.addKeyResultDependency",
  summary:
    "Records a key result's dependency on a providing team, for the register (METHOD.md §5.4).",
  input: z
    .object({
      keyResultId: z.uuid(),
      providerSpaceId: z.uuid().optional(),
      providerText: z.string().trim().max(200).optional(),
      note: z.string().trim().max(500).optional(),
      riskOwnerId: z.uuid().optional(),
    })
    .refine(
      (value) => Boolean(value.providerSpaceId) || Boolean(value.providerText),
      {
        message:
          "A dependency names who provides it, either a space in this workspace or a name. A register entry with no provider is not one.",
      },
    ),
  output: z.object({ id: z.uuid(), blocksPublish: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const goal = await requireKeyResultGoal(
        tx,
        workspaceId,
        memberId,
        input.keyResultId,
        ACCESS_LEVELS.edit,
      );

      if (input.providerSpaceId) {
        const [space] = await tx
          .select({ id: spaces.id })
          .from(spaces)
          .where(
            activeOnly(
              spaces,
              eq(spaces.workspaceId, workspaceId),
              eq(spaces.id, input.providerSpaceId),
            ),
          )
          .limit(1);
        if (!space) {
          throw new OperationError("not_found", "No such space.");
        }
      }

      const id = newId();
      // openokr:allow-mutation: same transaction.
      await tx.insert(keyResultDependencies).values({
        id,
        workspaceId,
        keyResultId: input.keyResultId,
        providerSpaceId: input.providerSpaceId ?? null,
        providerText: input.providerText ?? null,
        note: input.note ?? null,
        riskOwnerId: input.riskOwnerId ?? null,
        createdById: memberId,
      });

      await recomputeAlignmentFor(tx, workspaceId, [goal]);

      return {
        // New entries are never confirmed: confirmation is the providing team's
        // act, and a depending team confirming its own dependency would make the
        // register a wish list.
        result: { id, blocksPublish: !input.riskOwnerId },
        activity: {
          kind: "alignment.register_added" as const,
          subjectType: "goal" as const,
          subjectId: goal.id,
          payload: {
            provider: input.providerText ?? "another team in this workspace",
          },
        },
        audit: {
          action: "goals.addKeyResultDependency",
          targetType: "key_result_dependency",
          targetId: id,
          payload: { keyResultId: input.keyResultId },
        },
      };
    },
  }),
});

export const confirmKeyResultDependency = defineWriteAction({
  name: "goals.confirmDependency",
  summary:
    "The providing team confirms a dependency. Only they can, and it clears publish gate 4.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), confirmed: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({
          id: keyResultDependencies.id,
          keyResultId: keyResultDependencies.keyResultId,
          providerSpaceId: keyResultDependencies.providerSpaceId,
          confirmed: keyResultDependencies.confirmed,
        })
        .from(keyResultDependencies)
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.workspaceId, workspaceId),
            eq(keyResultDependencies.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such dependency.");
      }
      if (!row.providerSpaceId) {
        throw new OperationError(
          "forbidden",
          "This dependency names its provider as free text, so there is nobody in this workspace who can confirm it. Name a risk owner instead.",
        );
      }
      if (row.confirmed) {
        return {
          result: { id: input.id, confirmed: true },
          activity: {
            kind: "alignment.register_confirmed" as const,
            subjectType: "space" as const,
            subjectId: row.providerSpaceId,
            payload: {},
          },
          audit: {
            action: "goals.confirmDependency",
            targetType: "key_result_dependency",
            targetId: input.id,
            payload: { repeat: true },
          },
        };
      }

      // The providing side, not the depending side. §5.4 makes confirmation the
      // providing team's statement that it will deliver; anybody else saying so
      // is the depending team confirming its own wish.
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "space",
        resourceId: row.providerSpaceId,
        requires: ACCESS_LEVELS.edit as never,
      });

      const goal = await requireKeyResultGoal(
        tx,
        workspaceId,
        memberId,
        row.keyResultId,
        ACCESS_LEVELS.view,
      );

      const now = new Date();
      // openokr:allow-mutation: same transaction.
      await tx
        .update(keyResultDependencies)
        .set({
          confirmed: true,
          confirmedById: memberId,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.id, input.id),
          ),
        );

      await recomputeAlignmentFor(tx, workspaceId, [goal]);

      return {
        result: { id: input.id, confirmed: true },
        activity: {
          kind: "alignment.register_confirmed" as const,
          subjectType: "space" as const,
          subjectId: row.providerSpaceId,
          payload: {},
        },
        audit: {
          action: "goals.confirmDependency",
          targetType: "key_result_dependency",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const setDependencyRiskOwner = defineWriteAction({
  name: "goals.setDependencyRiskOwner",
  summary:
    "Names who carries the risk of an unconfirmed dependency. Clears publish gate 4 without claiming a confirmation.",
  input: z.object({ id: z.uuid(), memberId: z.uuid().nullable() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const actor = await actingMember(tx, workspaceId, context.actor.userId);
      const [row] = await tx
        .select({
          id: keyResultDependencies.id,
          keyResultId: keyResultDependencies.keyResultId,
        })
        .from(keyResultDependencies)
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.workspaceId, workspaceId),
            eq(keyResultDependencies.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such dependency.");
      }
      const goal = await requireKeyResultGoal(
        tx,
        workspaceId,
        actor,
        row.keyResultId,
        ACCESS_LEVELS.edit,
      );

      if (input.memberId) {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.id, input.memberId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);
        if (!member) {
          throw new OperationError(
            "not_found",
            "No such member. A risk owner is a person who is still here.",
          );
        }
      }

      // openokr:allow-mutation: same transaction.
      await tx
        .update(keyResultDependencies)
        .set({ riskOwnerId: input.memberId, updatedAt: new Date() })
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.id, input.id),
          ),
        );

      // No recompute: the score reads whether a link exists, never whether
      // somebody owns its risk. Gate 4 reads the risk owner; §5.2 does not.
      return {
        result: { id: input.id },
        activity: {
          // The goal, not the key result: the activity context resolver knows
          // how to scope a goal, and an activity it cannot scope is invisible to
          // every context-filtered feed.
          kind: "alignment.register_risk_owned" as const,
          subjectType: "goal" as const,
          subjectId: goal.id,
          payload: {},
        },
        audit: {
          action: "goals.setDependencyRiskOwner",
          targetType: "key_result_dependency",
          targetId: input.id,
          payload: { memberId: input.memberId },
        },
      };
    },
  }),
});

export const removeKeyResultDependency = defineWriteAction({
  name: "goals.removeKeyResultDependency",
  summary: "Removes an entry from the dependency register.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({
          id: keyResultDependencies.id,
          keyResultId: keyResultDependencies.keyResultId,
        })
        .from(keyResultDependencies)
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.workspaceId, workspaceId),
            eq(keyResultDependencies.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such dependency.");
      }
      const goal = await requireKeyResultGoal(
        tx,
        workspaceId,
        memberId,
        row.keyResultId,
        ACCESS_LEVELS.edit,
      );

      const now = new Date();
      // openokr:allow-mutation: same transaction.
      await tx
        .update(keyResultDependencies)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.id, input.id),
          ),
        );

      await recomputeAlignmentFor(tx, workspaceId, [goal]);

      return {
        result: { id: input.id },
        activity: {
          kind: "alignment.register_removed" as const,
          subjectType: "goal" as const,
          subjectId: goal.id,
          payload: {},
        },
        audit: {
          action: "goals.removeKeyResultDependency",
          targetType: "key_result_dependency",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const dismissAlignmentFinding = defineWriteAction({
  name: "alignment.dismissFinding",
  summary:
    "Dismisses a finding. It stays dismissed while the condition is unchanged.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({
          id: alignmentFindings.id,
          ruleKey: alignmentFindings.ruleKey,
          subjectGoalId: alignmentFindings.subjectGoalId,
          cycleId: alignmentFindings.cycleId,
        })
        .from(alignmentFindings)
        .where(
          activeOnly(
            alignmentFindings,
            eq(alignmentFindings.workspaceId, workspaceId),
            eq(alignmentFindings.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such finding.");
      }
      if (row.subjectGoalId) {
        await requireGoal(
          tx,
          workspaceId,
          memberId,
          row.subjectGoalId,
          ACCESS_LEVELS.edit,
        );
      }

      const now = new Date();
      // openokr:allow-mutation: same transaction.
      await tx
        .update(alignmentFindings)
        .set({
          state: "dismissed",
          decidedById: memberId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          activeOnly(alignmentFindings, eq(alignmentFindings.id, input.id)),
        );

      return {
        result: { id: input.id },
        activity: {
          // The goal the finding opens, when it has one. The anchor finding has
          // none, and its subject is the cycle it was raised against.
          kind: "alignment.finding_dismissed" as const,
          subjectType: row.subjectGoalId
            ? ("goal" as const)
            : ("cycle" as const),
          subjectId: row.subjectGoalId ?? row.cycleId,
          payload: { ruleKey: row.ruleKey ?? "" },
        },
        audit: {
          action: "alignment.dismissFinding",
          targetType: "alignment_finding",
          targetId: input.id,
          payload: { ruleKey: row.ruleKey },
        },
      };
    },
  }),
});

export const readAlignmentGraph = defineReadAction({
  name: "alignment.graph",
  summary:
    "The cascade as nodes and edges, for the alignment studio canvas (S-16).",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    nodes: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        level: z.string(),
        owner: z.string(),
        parentGoalId: z.uuid().nullable(),
        keyResultCount: z.number().int(),
        dependencyCount: z.number().int(),
        health: z.string(),
        progressPct: z.number(),
        /** Below company level with no parent: §5.2's AL-1, drawn on the card. */
        unaligned: z.boolean(),
        closed: z.boolean(),
      }),
    ),
    edges: z.array(z.object({ id: z.uuid(), from: z.uuid(), to: z.uuid() })),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);

        const rows = await tx
          .select({
            id: goals.id,
            title: goals.title,
            level: goals.level,
            spaceId: goals.spaceId,
            memberId: goals.memberId,
            parentGoalId: goals.parentGoalId,
            parentKeyResultId: goals.parentKeyResultId,
            health: goals.health,
            progressPct: goals.progressPct,
            closedAt: goals.closedAt,
          })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.cycleId, input.cycleId),
            ),
          );

        // Only what this reader may see. A canvas is a picture of the whole
        // organisation, and a picture is exactly the wrong place to leak one.
        const visible = [];
        for (const row of rows) {
          try {
            await getAccessScoped(tx, {
              workspaceId: context.workspaceId,
              memberId,
              resourceType: "goal",
              resourceId: row.id,
              requires: ACCESS_LEVELS.view as never,
            });
            visible.push(row);
          } catch (error) {
            if (error instanceof OperationError && error.code === "not_found") {
              continue;
            }
            throw error;
          }
        }

        const ids = visible.map((row) => row.id);
        if (ids.length === 0) {
          return { nodes: [], edges: [] };
        }

        const keyResultRows = await tx
          .select({ id: keyResults.id, goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              inArray(keyResults.goalId, ids),
            ),
          );
        const countByGoal = new Map<string, number>();
        const ownerOfKeyResult = new Map<string, string>();
        for (const row of keyResultRows) {
          countByGoal.set(row.goalId, (countByGoal.get(row.goalId) ?? 0) + 1);
          ownerOfKeyResult.set(row.id, row.goalId);
        }

        const linkRows = await tx
          .select({
            id: goalDependencies.id,
            from: goalDependencies.fromGoalId,
            to: goalDependencies.toGoalId,
          })
          .from(goalDependencies)
          .where(
            activeOnly(
              goalDependencies,
              eq(goalDependencies.workspaceId, context.workspaceId),
            ),
          );
        // Both ends must be on the canvas, or the edge would point at nothing.
        const onCanvas = new Set(ids);
        const edges = linkRows.filter(
          (row) => onCanvas.has(row.from) && onCanvas.has(row.to),
        );
        const degree = new Map<string, number>();
        for (const edge of edges) {
          degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
          degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
        }

        const spaceNames = new Map(
          (
            await tx
              .select({ id: spaces.id, name: spaces.name })
              // openokr:allow-raw-read: names only, and every human member holds
              // `view` on every space through the `workspace_standard` binding
              // P3-T01 gives them, so this discloses nothing the spaces list
              // does not. The card needs an owner's name, not an identifier.
              .from(spaces)
              .where(
                activeOnly(spaces, eq(spaces.workspaceId, context.workspaceId)),
              )
          ).map((row) => [row.id, row.name]),
        );
        const memberNames = new Map(
          (
            await tx
              .select({ id: workspaceMembers.id, name: workspaceMembers.name })
              .from(workspaceMembers)
              .where(
                activeOnly(
                  workspaceMembers,
                  eq(workspaceMembers.workspaceId, context.workspaceId),
                ),
              )
          ).map((row) => [row.id, row.name]),
        );

        return {
          nodes: visible.map((row) => {
            // A key result parent hangs the child off the goal that owns it, so
            // the canvas draws one connector rather than a dangling stub.
            const parentGoalId =
              row.parentGoalId ??
              (row.parentKeyResultId
                ? (ownerOfKeyResult.get(row.parentKeyResultId) ?? null)
                : null);
            return {
              id: row.id,
              title: row.title,
              level: row.level,
              owner:
                (row.spaceId
                  ? spaceNames.get(row.spaceId)
                  : row.memberId
                    ? memberNames.get(row.memberId)
                    : "the workspace") ?? "the workspace",
              parentGoalId,
              keyResultCount: countByGoal.get(row.id) ?? 0,
              dependencyCount: degree.get(row.id) ?? 0,
              health: row.health,
              progressPct: Number(row.progressPct),
              unaligned: row.level !== "company" && parentGoalId === null,
              closed: row.closedAt !== null,
            };
          }),
          edges: edges.map((edge) => ({
            id: edge.id,
            from: edge.from,
            to: edge.to,
          })),
        };
      },
    );
  },
});

export const readAlignment = defineReadAction({
  name: "alignment.read",
  summary:
    "The alignment health score for one cycle, with every open finding and the goal each one opens.",
  input: z.object({
    cycleId: z.uuid(),
    spaceId: z.uuid().optional(),
    /** Dismissed findings are hidden by default; the studio can ask for them. */
    includeDismissed: z.boolean().default(false),
  }),
  output: z.object({
    score: z.number().nullable(),
    healthy: z.boolean().nullable(),
    threshold: z.number(),
    goalCount: z.number().int(),
    findings: z.array(
      z.object({
        id: z.uuid(),
        ruleKey: z.string().nullable(),
        severity: z.string(),
        kind: z.string(),
        reason: z.string(),
        state: z.string(),
        source: z.string(),
        subjectGoalId: z.uuid().nullable(),
        subjectGoalTitle: z.string().nullable(),
      }),
    ),
    /** The §5.4 register for this cycle: what depends on whom, and who carries it. */
    register: z.array(
      z.object({
        id: z.uuid(),
        keyResultId: z.uuid(),
        keyResultTitle: z.string(),
        goalId: z.uuid(),
        goalTitle: z.string(),
        provider: z.string(),
        providerSpaceId: z.uuid().nullable(),
        confirmed: z.boolean(),
        riskOwnerId: z.uuid().nullable(),
        riskOwnerName: z.string().nullable(),
        /** Unconfirmed and unowned, which is what publish gate 4 refuses. */
        blocksPublish: z.boolean(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const rhythm = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        const threshold = rhythm.thresholds["alignment.healthyThreshold"];
        const scope = input.spaceId
          ? ({ kind: "space", spaceId: input.spaceId } as const)
          : ({ kind: "workspace" } as const);

        // Read, never write. The stored findings are what recompute left behind;
        // this recomputes the score from the graph so the number on the screen
        // cannot lag a write that forgot to trigger one, and says so if the two
        // ever disagree by simply being the live answer.
        const graph = await loadAlignmentGraph(tx, {
          workspaceId: context.workspaceId,
          cycleId: input.cycleId,
          scope,
        });
        const live = alignmentScore(
          graph,
          scope,
          rhythm.thresholds["alignment.penalties"],
        );

        const stateFilter = input.includeDismissed
          ? undefined
          : eq(alignmentFindings.state, "open");

        const rows = await tx
          .select({
            id: alignmentFindings.id,
            ruleKey: alignmentFindings.ruleKey,
            severity: alignmentFindings.severity,
            kind: alignmentFindings.kind,
            reason: alignmentFindings.reason,
            state: alignmentFindings.state,
            source: alignmentFindings.source,
            subjectGoalId: alignmentFindings.subjectGoalId,
            subjectGoalTitle: goals.title,
          })
          .from(alignmentFindings)
          .leftJoin(
            goals,
            and(
              eq(goals.id, alignmentFindings.subjectGoalId),
              isNull(goals.deletedAt),
            ),
          )
          .where(
            activeOnly(
              alignmentFindings,
              eq(alignmentFindings.workspaceId, context.workspaceId),
              eq(alignmentFindings.cycleId, input.cycleId),
              eq(alignmentFindings.scope, scope.kind),
              scope.kind === "space"
                ? eq(alignmentFindings.scopeId, scope.spaceId)
                : isNull(alignmentFindings.scopeId),
              ...(stateFilter ? [stateFilter] : []),
            ),
          )
          .orderBy(asc(alignmentFindings.severity), asc(alignmentFindings.id));

        // A finding on a goal the reader cannot see is not shown, the same way
        // the goal itself would not be. The score still counts it, because the
        // structure is a fact about the cycle rather than about the reader.
        const visible = [];
        for (const row of rows) {
          if (row.subjectGoalId) {
            try {
              await getAccessScoped(tx, {
                workspaceId: context.workspaceId,
                memberId,
                resourceType: "goal",
                resourceId: row.subjectGoalId,
                requires: ACCESS_LEVELS.view as never,
              });
            } catch (error) {
              if (
                error instanceof OperationError &&
                error.code === "not_found"
              ) {
                continue;
              }
              throw error;
            }
          }
          visible.push(row);
        }

        // The register, for the goals this reader can see. §5.4's four columns:
        // the key result that depends, the providing team, whether they have
        // confirmed, and if not, a named risk owner.
        const visibleGoalIds: string[] = [];
        for (const goal of graph.goals) {
          try {
            await getAccessScoped(tx, {
              workspaceId: context.workspaceId,
              memberId,
              resourceType: "goal",
              resourceId: goal.id,
              requires: ACCESS_LEVELS.view as never,
            });
            visibleGoalIds.push(goal.id);
          } catch (error) {
            if (error instanceof OperationError && error.code === "not_found") {
              continue;
            }
            throw error;
          }
        }

        const keyResultRows =
          visibleGoalIds.length === 0
            ? []
            : await tx
                .select({
                  id: keyResults.id,
                  title: keyResults.title,
                  goalId: keyResults.goalId,
                  goalTitle: goals.title,
                })
                .from(keyResults)
                .innerJoin(goals, eq(goals.id, keyResults.goalId))
                .where(
                  activeOnly(
                    keyResults,
                    eq(keyResults.workspaceId, context.workspaceId),
                    inArray(keyResults.goalId, visibleGoalIds),
                  ),
                );
        const byKeyResult = new Map(keyResultRows.map((row) => [row.id, row]));

        const registerRows = await loadDependencyRegister(
          tx,
          context.workspaceId,
          keyResultRows.map((row) => row.id),
        );

        const spaceNames = new Map(
          (
            await tx
              .select({ id: spaces.id, name: spaces.name })
              // openokr:allow-raw-read: names only, and every human member
              // already holds `view` on every space through the
              // `workspace_standard` binding P3-T01 gives them for discovery, so
              // this discloses nothing the spaces list does not. Going through
              // the getter here would be one authorisation round trip per space
              // to learn a fact the reader can already read, and a register that
              // said "a team" instead of "Product" would be useless in the room
              // it is read in.
              .from(spaces)
              .where(
                activeOnly(spaces, eq(spaces.workspaceId, context.workspaceId)),
              )
          ).map((row) => [row.id, row.name]),
        );
        const memberNames = new Map(
          (
            await tx
              .select({ id: workspaceMembers.id, name: workspaceMembers.name })
              .from(workspaceMembers)
              .where(
                activeOnly(
                  workspaceMembers,
                  eq(workspaceMembers.workspaceId, context.workspaceId),
                ),
              )
          ).map((row) => [row.id, row.name]),
        );

        const register = registerRows.flatMap((row) => {
          const keyResult = byKeyResult.get(row.keyResultId);
          if (!keyResult) {
            return [];
          }
          return [
            {
              id: row.id,
              keyResultId: row.keyResultId,
              keyResultTitle: keyResult.title,
              goalId: keyResult.goalId,
              goalTitle: keyResult.goalTitle,
              provider:
                (row.providerSpaceId
                  ? spaceNames.get(row.providerSpaceId)
                  : row.providerText) ?? "a team that no longer exists",
              providerSpaceId: row.providerSpaceId,
              confirmed: row.confirmed,
              riskOwnerId: row.riskOwnerId,
              riskOwnerName: row.riskOwnerId
                ? (memberNames.get(row.riskOwnerId) ?? null)
                : null,
              blocksPublish: blocksPublish(row),
            },
          ];
        });

        return {
          score: live.score,
          healthy:
            live.score === null
              ? null
              : alignmentHealthy(live.score, threshold),
          threshold,
          goalCount: graph.goals.length,
          findings: visible,
          register,
        };
      },
    );
  },
});
