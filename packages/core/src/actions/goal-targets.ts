/**
 * Changing a key result's target with its history, and bringing back a key
 * result removed on its own (P9-T06b, METHOD v2 §2.9).
 *
 * **Every target write goes through `changeTargetInTx`.** `goals.changeTarget`
 * is the action the list and the drawer use, and `goals.updateKeyResult`
 * still takes a target for the callers it already has; both land here, so the
 * reason rule and the history cannot be stepped round by choosing the other
 * door. Easing a target, toward its baseline, needs a written reason where the
 * workspace asks for one (§12, "Reason when easing a target"), and making it
 * harder never does. The original stays on record either way.
 */
import {
  activeOnly,
  cycles,
  goals,
  includeDeleted,
  keyResults,
  keyResultTargetChanges,
  type WorkspaceTx,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import {
  isEasing,
  type KeyResultDirection,
  type KeyResultKind,
} from "@openokr/method";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { asNumber } from "../goals/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { requirePolicy } from "../practice/policy.ts";
import { recomputeGoalQualityInTx } from "../quality/service.ts";
import { recomputeForGoal } from "../scoring/recompute.ts";
import { recomputeAlignmentFor } from "./alignment.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { treeGoal, treeNode } from "./goal-tree.ts";

/** A reason worth the name: some words, not whitespace. */
export const targetReason = z.string().trim().min(1).max(500);

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

export interface TargetChange {
  readonly goalId: string;
  /** Null when the key result had no target yet (P9-T13-b-a). */
  readonly from: number | null;
  readonly to: number;
  readonly eased: boolean;
  /** False when the target was already the one asked for. */
  readonly changed: boolean;
}

/**
 * Moves a key result's target and records the move, inside the caller's
 * transaction. Access is the caller's to have checked.
 *
 * A target set to what it already is records nothing and asks nothing, so a
 * form that submits every field cannot write a history row for a target
 * nobody touched.
 */
export async function changeTargetInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly keyResultId: string;
    readonly to: number;
    readonly reason?: string | null;
    readonly actorMemberId: string | null;
    /** An import records history and is never refused (design §2.5). */
    readonly bulk?: boolean;
    /**
     * The key result as it stood before the caller's own write, when the same
     * call also changes its baseline, direction or kind. Easing is judged
     * against that, so a baseline moved in the same breath cannot make an
     * easier target read as a harder one.
     */
    readonly before?: {
      readonly baseline: number;
      readonly direction: KeyResultDirection;
      readonly kind: KeyResultKind;
    };
  },
): Promise<TargetChange> {
  const [row] = await tx
    .select({
      goalId: keyResults.goalId,
      targetValue: keyResults.targetValue,
      baselineValue: keyResults.baselineValue,
      direction: keyResults.direction,
      kind: keyResults.kind,
      published: cycles.publishedAt,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .leftJoin(cycles, eq(cycles.id, goals.cycleId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, input.keyResultId),
      ),
    )
    .for("update", { of: keyResults })
    .limit(1);
  if (!row) {
    throw new OperationError("not_found", "No such key result.");
  }
  const from = asNumber(row.targetValue);
  const baseline = input.before?.baseline ?? asNumber(row.baselineValue) ?? 0;
  const direction = input.before?.direction ?? row.direction;
  const keyResultKind = input.before?.kind ?? row.kind;
  if (from === input.to) {
    return { goalId: row.goalId, from, to: from, eased: false, changed: false };
  }
  if (from === null) {
    // A first target is neither harder nor easier than one that did not
    // exist, so it asks nothing and writes no history row: there is no
    // earlier target to keep on record (METHOD.md §2.9, P9-T13-b-a).
    // openokr:allow-mutation: inside the operation that called this.
    await tx
      .update(keyResults)
      .set({ targetValue: String(input.to), updatedAt: new Date() })
      .where(
        activeOnly(
          keyResults,
          eq(keyResults.workspaceId, input.workspaceId),
          eq(keyResults.id, input.keyResultId),
        ),
      );
    return {
      goalId: row.goalId,
      from: null,
      to: input.to,
      eased: false,
      changed: true,
    };
  }
  const reason = input.reason?.trim() || null;
  await requirePolicy(
    tx,
    {
      workspaceId: input.workspaceId,
      ...(input.bulk === undefined ? {} : { bulk: input.bulk }),
    },
    {
      kind: "target.change",
      from,
      to: input.to,
      baseline,
      direction,
      keyResultKind,
      hasReason: reason !== null,
    },
  );

  const eased = isEasing({
    from,
    to: input.to,
    baseline,
    direction,
    keyResultKind,
  });
  // openokr:allow-mutation: inside the operation that called this; the
  // change, its history row, the activity and the audit commit together.
  await tx
    .update(keyResults)
    .set({ targetValue: String(input.to), updatedAt: new Date() })
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, input.keyResultId),
      ),
    );
  // openokr:allow-mutation: the history row of the same change.
  await tx.insert(keyResultTargetChanges).values({
    workspaceId: input.workspaceId,
    keyResultId: input.keyResultId,
    fromValue: String(from),
    toValue: String(input.to),
    baselineValue: String(baseline),
    eased,
    reason,
    midCycle: row.published !== null,
    actorMemberId: input.actorMemberId,
  });
  return { goalId: row.goalId, from, to: input.to, eased, changed: true };
}

export const changeKeyResultTarget = defineWriteAction({
  name: "goals.changeTarget",
  // openokr:policy-exempt: the policy is asked inside changeTargetInTx, which every target write goes through, so a caller cannot reach the change without it.
  summary:
    "Changes a key result's target and records the change. Easing it toward its baseline needs a reason where the workspace asks for one.",
  input: z.object({
    id: z.uuid(),
    targetValue: z.number(),
    reason: targetReason.optional(),
  }),
  output: z.object({
    goal: treeGoal,
    change: z.object({
      /** Null when this was the key result's first target. */
      from: z.number().nullable(),
      to: z.number(),
      eased: z.boolean(),
      changed: z.boolean(),
    }),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [owner] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.id),
          ),
        )
        .limit(1);
      if (!owner) {
        throw new OperationError("not_found", "No such key result.");
      }
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: owner.goalId,
        requires: ACCESS_LEVELS.edit,
      });

      const change = await changeTargetInTx(tx, {
        workspaceId,
        keyResultId: input.id,
        to: input.targetValue,
        reason: input.reason ?? null,
        actorMemberId: memberId,
        ...(context.bulk === undefined ? {} : { bulk: context.bulk }),
      });
      if (change.changed) {
        const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
        await recomputeForGoal(
          tx,
          workspaceId,
          owner.goalId,
          rhythm.thresholds,
        );
        await recomputeGoalQualityInTx(tx, {
          workspaceId,
          goalId: owner.goalId,
        });
      }

      return {
        result: {
          goal: await treeNode(tx, workspaceId, owner.goalId),
          change: {
            from: change.from,
            to: change.to,
            eased: change.eased,
            changed: change.changed,
          },
        },
        activity: {
          kind: "key_result.target_changed",
          subjectType: "goal",
          subjectId: owner.goalId,
          payload: {
            keyResultId: input.id,
            from: change.from,
            to: change.to,
            eased: change.eased,
          },
        },
        audit: {
          action: "goals.changeTarget",
          targetType: "key_result",
          targetId: input.id,
          payload: {
            from: change.from,
            to: change.to,
            eased: change.eased,
            reason: input.reason ?? null,
          },
        },
      };
    },
  }),
});

export const readTargetHistory = defineReadAction({
  name: "goals.targetHistory",
  summary:
    "Every change to a key result's target, oldest first, with who made it and the reason given for easing it.",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    changes: z.array(
      z.object({
        from: z.number(),
        to: z.number(),
        eased: z.boolean(),
        reason: z.string().nullable(),
        midCycle: z.boolean(),
        changedAt: z.string(),
        changedBy: z.string().nullable(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const workspaceId = context.workspaceId;
        const memberId = await actingMember(tx, workspaceId, userId);
        const [owner] = await tx
          .select({ goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              eq(keyResults.id, input.id),
            ),
          )
          .limit(1);
        if (!owner) {
          throw new OperationError("not_found", "No such key result.");
        }
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          resourceId: owner.goalId,
          requires: ACCESS_LEVELS.view,
        });
        const rows = await tx
          .select({
            from: keyResultTargetChanges.fromValue,
            to: keyResultTargetChanges.toValue,
            eased: keyResultTargetChanges.eased,
            reason: keyResultTargetChanges.reason,
            midCycle: keyResultTargetChanges.midCycle,
            changedAt: keyResultTargetChanges.changedAt,
            changedBy: workspaceMembers.name,
          })
          .from(keyResultTargetChanges)
          .leftJoin(
            workspaceMembers,
            eq(workspaceMembers.id, keyResultTargetChanges.actorMemberId),
          )
          .where(
            activeOnly(
              keyResultTargetChanges,
              eq(keyResultTargetChanges.workspaceId, workspaceId),
              eq(keyResultTargetChanges.keyResultId, input.id),
            ),
          )
          .orderBy(
            asc(keyResultTargetChanges.changedAt),
            asc(keyResultTargetChanges.id),
          );
        return {
          changes: rows.map((row) => ({
            from: asNumber(row.from) ?? 0,
            to: asNumber(row.to) ?? 0,
            eased: row.eased,
            reason: row.reason,
            midCycle: row.midCycle,
            changedAt: new Date(row.changedAt).toISOString(),
            changedBy: row.changedBy ?? null,
          })),
        };
      },
    );
  },
});

export const restoreKeyResult = defineWriteAction({
  name: "goals.restoreKeyResult",
  // openokr:policy-exempt: bringing back a key result somebody removed puts an existing objective back as it was, which stays open under every setting (METHOD.md §2.9).
  summary:
    "Brings back a key result that was removed on its own, with its value history.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ goal: treeGoal }),
  // The level its removal asked, so whoever could take it out can put it back.
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({
          goalId: keyResults.goalId,
          title: keyResults.title,
          goalDeletedAt: goals.deletedAt,
          cycleId: goals.cycleId,
          spaceId: goals.spaceId,
        })
        .from(keyResults)
        .innerJoin(goals, eq(goals.id, keyResults.goalId))
        .where(
          includeDeleted(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.id),
            isNotNull(keyResults.deletedAt),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such removed key result.");
      }
      if (row.goalDeletedAt !== null) {
        // Its goal was deleted with it, and restoring the goal brings it
        // back; restoring the key result alone would hang it under nothing.
        throw new OperationError(
          "forbidden",
          "Its objective was deleted too. Restore the objective, and this key result comes back with it.",
        );
      }
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: row.goalId,
        requires: ACCESS_LEVELS.full,
      });

      // openokr:allow-mutation: the operation's own execute.
      await tx
        .update(keyResults)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(
          includeDeleted(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.id),
          ),
        );
      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      await recomputeForGoal(tx, workspaceId, row.goalId, rhythm.thresholds);
      await recomputeGoalQualityInTx(tx, { workspaceId, goalId: row.goalId });
      // KR-1 is an alignment finding at none, so a restore that brings an
      // objective back from none clears it, as adding one does.
      await recomputeAlignmentFor(tx, workspaceId, [
        { cycleId: row.cycleId, spaceId: row.spaceId },
      ]);

      return {
        result: { goal: await treeNode(tx, workspaceId, row.goalId) },
        activity: {
          kind: "key_result.restored",
          subjectType: "goal",
          subjectId: row.goalId,
          payload: { keyResultId: input.id, title: row.title },
        },
        audit: {
          action: "goals.restoreKeyResult",
          targetType: "key_result",
          targetId: input.id,
          payload: { goalId: row.goalId, title: row.title },
        },
      };
    },
  }),
});

/**
 * Key results removed on their own, newest first, for deleted items.
 *
 * Only those whose objective is still live: a key result deleted with its
 * objective comes back with the objective, and listing it twice would offer
 * two ways to do one thing.
 */
export async function removedKeyResults(
  tx: OperationTx,
  workspaceId: string,
  limit: number,
): Promise<
  {
    id: string;
    goalId: string;
    title: string;
    goalTitle: string;
    deletedAt: Date;
  }[]
> {
  const rows = await tx
    .select({
      id: keyResults.id,
      goalId: keyResults.goalId,
      title: keyResults.title,
      goalTitle: goals.title,
      deletedAt: keyResults.deletedAt,
    })
    .from(keyResults)
    .innerJoin(
      goals,
      and(eq(goals.id, keyResults.goalId), isNull(goals.deletedAt)),
    )
    .where(
      includeDeleted(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        isNotNull(keyResults.deletedAt),
      ),
    )
    .orderBy(desc(keyResults.deletedAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, deletedAt: row.deletedAt as Date }));
}
