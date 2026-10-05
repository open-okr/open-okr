/**
 * What moved in a cycle, for the scorecard (METHOD.md §3.3, §2.9, §2.8,
 * P9-T14c).
 *
 * A closed cycle's result is one number, and the method keeps what is behind
 * it so the close can see it: a score a person adjusted beside the one §2.10
 * computed, an eased target beside its original, what was started mid-cycle,
 * and every change of kind with its reason. This gathers those for one cycle.
 *
 * **Only what the reader may see.** The lists name objectives and key results,
 * so they pass through the access model's one set of visible goals, as the
 * tree and the list do.
 */
import {
  activeOnly,
  activities,
  goals,
  keyResults,
  keyResultTargetChanges,
  type WorkspaceTx,
} from "@openokr/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { visibleResourceIds } from "../access/reads.ts";

/** Plain arrays, because the contract that carries them has no readonly. */
export interface CycleMoves {
  readonly adjusted: {
    readonly keyResultId: string;
    readonly title: string;
    readonly score: number;
    readonly computed: number;
    readonly reason: string;
  }[];
  readonly eased: {
    readonly keyResultId: string;
    readonly title: string;
    readonly original: number;
    readonly target: number | null;
    readonly reason: string | null;
  }[];
  readonly addedMidCycle: number;
  readonly kindChanges: {
    readonly goalId: string;
    readonly title: string;
    readonly from: string;
    readonly to: string;
    readonly reason: string | null;
    readonly at: string;
  }[];
}

export async function cycleMovesInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly cycleId: string;
  },
): Promise<CycleMoves> {
  const inCycle = await tx
    .select({
      id: goals.id,
      title: goals.title,
      addedMidCycleAt: goals.addedMidCycleAt,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.cycleId, input.cycleId),
      ),
    );
  const allowed = await visibleResourceIds(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    resourceType: "goal",
    ids: inCycle.map((goal) => goal.id),
    requires: ACCESS_LEVELS.view,
  });
  const visible = inCycle.filter((goal) => allowed.has(goal.id));
  const goalIds = visible.map((goal) => goal.id);
  if (goalIds.length === 0) {
    return { adjusted: [], eased: [], addedMidCycle: 0, kindChanges: [] };
  }
  const titleOf = new Map(visible.map((goal) => [goal.id, goal.title]));

  const children = await tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      targetValue: keyResults.targetValue,
      score: keyResults.score,
      scoreComputed: keyResults.scoreComputed,
      scoreReason: keyResults.scoreReason,
      addedMidCycleAt: keyResults.addedMidCycleAt,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        inArray(keyResults.goalId, goalIds),
      ),
    )
    .orderBy(asc(keyResults.position));

  const adjusted = children.flatMap((child) =>
    child.scoreReason !== null &&
    child.score !== null &&
    child.scoreComputed !== null
      ? [
          {
            keyResultId: child.id,
            title: child.title,
            score: Number(child.score),
            computed: Number(child.scoreComputed),
            reason: child.scoreReason,
          },
        ]
      : [],
  );

  const changes =
    children.length === 0
      ? []
      : await tx
          .select({
            keyResultId: keyResultTargetChanges.keyResultId,
            fromValue: keyResultTargetChanges.fromValue,
            eased: keyResultTargetChanges.eased,
            reason: keyResultTargetChanges.reason,
          })
          .from(keyResultTargetChanges)
          .where(
            activeOnly(
              keyResultTargetChanges,
              eq(keyResultTargetChanges.workspaceId, input.workspaceId),
              inArray(
                keyResultTargetChanges.keyResultId,
                children.map((child) => child.id),
              ),
            ),
          )
          .orderBy(asc(keyResultTargetChanges.changedAt));
  const first = new Map<string, number>();
  const easedBecause = new Map<string, string | null>();
  for (const change of changes) {
    if (!first.has(change.keyResultId)) {
      first.set(change.keyResultId, Number(change.fromValue));
    }
    if (change.eased) {
      easedBecause.set(change.keyResultId, change.reason);
    }
  }
  const eased = children.flatMap((child) => {
    const original = first.get(child.id);
    if (original === undefined || !easedBecause.has(child.id)) {
      return [];
    }
    return [
      {
        keyResultId: child.id,
        title: child.title,
        original,
        target: child.targetValue === null ? null : Number(child.targetValue),
        reason: easedBecause.get(child.id) ?? null,
      },
    ];
  });

  const addedMidCycle =
    visible.filter((goal) => goal.addedMidCycleAt !== null).length +
    children.filter((child) => child.addedMidCycleAt !== null).length;

  const kindRows = await tx
    .select({
      goalId: activities.subjectId,
      payload: activities.payload,
      at: activities.at,
    })
    .from(activities)
    .where(
      and(
        eq(activities.workspaceId, input.workspaceId),
        eq(activities.kind, "goal.kind_changed"),
        inArray(activities.subjectId, goalIds),
      ),
    )
    .orderBy(asc(activities.at));
  const kindChanges = kindRows.map((row) => {
    const payload = (row.payload ?? {}) as {
      from?: string;
      to?: string;
      reason?: string | null;
    };
    return {
      goalId: row.goalId,
      title: titleOf.get(row.goalId) ?? "",
      from: payload.from ?? "",
      to: payload.to ?? "",
      reason: payload.reason ?? null,
      at: new Date(row.at).toISOString(),
    };
  });

  return { adjusted, eased, addedMidCycle, kindChanges };
}
