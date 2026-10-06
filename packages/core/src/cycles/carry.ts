/**
 * What an objective's close decision hands the next cycle (METHOD.md §8.8,
 * §8.9, P9-T20e-b).
 *
 * §8.8: "Keep: still relevant. It pre-fills next cycle's draft, and still
 * passes next cycle's checks." §8.9's row: "Every kept or modified objective |
 * Phase 4, a pre-filled draft whose key results start from their last
 * recorded values as baselines."
 *
 * **A draft, not a copy.** The new objective is an ordinary one in the next
 * cycle: it goes through Phase 4's checks and Phase 5's gates like any other,
 * nothing about it is locked, and it remembers where it came from in
 * `carried_from_goal_id`, which is also what makes a second feed-forward
 * write nothing. What belonged to the old cycle stays behind: its alignment,
 * its contribution statement, its due dates and its capacity verdicts, which
 * Phase 5 asks for again, and its check-ins, which were about last quarter.
 */
import {
  activeOnly,
  type GoalCloseDecision,
  goals,
  includeDeleted,
  type KeyResultKind,
  keyResults,
  reviewDecisions,
  workspaceMembers,
} from "@openokr/db";
import type { ResolvedThresholds } from "@openokr/method";
import { asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { recomputeAlignment, scopesForGoal } from "../alignment/service.ts";
import { stampFirstDue } from "../cadence/service.ts";
import { seedGoalFrequencyInTx } from "../cadence/space-frequency.ts";
import {
  asNumber,
  createGoalInTx,
  createKeyResultInTx,
} from "../goals/service.ts";
import type { OperationTx } from "../operations/operation.ts";
import { midCycleInTx } from "../practice/policy.ts";
import { recomputeUnitQualityInTx } from "../quality/service.ts";
import { recomputeForGoal } from "../scoring/recompute.ts";

export interface ClosedObjective {
  readonly goalId: string;
  readonly title: string;
  readonly decision: GoalCloseDecision;
}

/**
 * Every objective in a cycle that was closed with a decision, and which one.
 *
 * Two places record a decision: stage 9 of the review, and an objective's own
 * close from its page. **The later one is the decision**, because it is the
 * one somebody made knowing the other: a room that decided keep and an owner
 * who then closed it as achieved have together said achieved.
 */
export async function closeDecisionsInTx(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
  reviewId: string | null,
): Promise<ClosedObjective[]> {
  const ownCloses = await tx
    .select({
      goalId: goals.id,
      title: goals.title,
      decision: goals.closeDecision,
      at: goals.closedAt,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
        isNotNull(goals.closeDecision),
      ),
    )
    .orderBy(asc(goals.position), asc(goals.createdAt));
  const decided = new Map<
    string,
    { title: string; decision: GoalCloseDecision; at: Date | null }
  >();
  for (const row of ownCloses) {
    if (row.decision) {
      decided.set(row.goalId, {
        title: row.title,
        decision: row.decision,
        at: row.at,
      });
    }
  }

  if (reviewId) {
    const roomDecisions = await tx
      .select({
        goalId: reviewDecisions.goalId,
        title: goals.title,
        decision: reviewDecisions.decision,
        at: reviewDecisions.updatedAt,
      })
      .from(reviewDecisions)
      .innerJoin(goals, eq(goals.id, reviewDecisions.goalId))
      .where(
        activeOnly(
          reviewDecisions,
          eq(reviewDecisions.workspaceId, workspaceId),
          eq(reviewDecisions.sessionId, reviewId),
          eq(goals.cycleId, cycleId),
          isNull(goals.deletedAt),
        ),
      )
      .orderBy(asc(goals.position), desc(reviewDecisions.updatedAt));
    for (const row of roomDecisions) {
      const own = decided.get(row.goalId);
      if (!own || own.at === null || own.at < row.at) {
        decided.set(row.goalId, {
          title: row.title,
          decision: row.decision,
          at: row.at,
        });
      }
    }
  }

  return [...decided].map(([goalId, value]) => ({
    goalId,
    title: value.title,
    decision: value.decision,
  }));
}

/** The decisions that pre-fill a draft (§8.8). */
export const CARRIED_DECISIONS: readonly GoalCloseDecision[] = [
  "keep",
  "modify",
];

/** One key result as the next cycle's draft starts it, or null to leave it. */
export interface CarriedKeyResult {
  readonly kind: KeyResultKind;
  readonly baselineValue: number;
  readonly targetValue: number | null;
}

/**
 * How a key result starts in the next cycle (§8.9): from its last recorded
 * value as the baseline.
 *
 * | Kind | Carried as |
 * |---|---|
 * | Metric, maintain | The same kind, baseline the last value, the same target |
 * | Milestone not done | A milestone again, not done |
 * | Milestone done | Left behind: it is done, and doing it again is not keeping it |
 * | Baseline not recorded | A baseline again, still to be measured |
 * | Baseline recorded | A metric from the number it found, its target to be set |
 *
 * A recorded baseline becomes a metric because the number nobody measured is
 * now known (§2.10), and the next question is where to move it. Its target is
 * left empty rather than guessed, so KR-3 asks for one.
 */
export function carriedKeyResult(source: {
  readonly kind: KeyResultKind;
  readonly doneAt: Date | null;
  readonly baselineValue: number;
  readonly targetValue: number | null;
  readonly currentValue: number;
}): CarriedKeyResult | null {
  switch (source.kind) {
    case "milestone":
      return source.doneAt
        ? null
        : { kind: "milestone", baselineValue: 0, targetValue: 1 };
    case "baseline":
      return source.doneAt
        ? {
            kind: "metric",
            baselineValue: source.currentValue,
            targetValue: null,
          }
        : { kind: "baseline", baselineValue: 0, targetValue: 1 };
    default:
      return {
        kind: source.kind,
        baselineValue: source.currentValue,
        targetValue: source.targetValue,
      };
  }
}

export interface CarryResult {
  /** Drafts written by this run. */
  readonly drafts: number;
  /**
   * Kept objectives this run could not carry, by title: their champion is no
   * longer an active member, and a draft needs somebody to own it (§2.5).
   */
  readonly notCarried: readonly string[];
}

/**
 * Pre-fills the next cycle with every kept and modified objective (§8.9).
 *
 * Idempotent on `carried_from_goal_id`: an objective already carried into
 * this cycle is not carried twice, **and one somebody deleted from the draft
 * stays deleted.** Deleting it is a decision about the next cycle, made after
 * the room's, and a re-run that put it back would overrule it.
 *
 * **Into a cycle that is already running, it waits as a draft** (§2.9). A
 * cycle closed late can feed one that has started, and an objective nobody
 * has looked at yet should not go live and start owing check-ins because a
 * different cycle closed.
 */
export async function carryKeptObjectivesInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly toCycleId: string;
    readonly kept: readonly ClosedObjective[];
    readonly thresholds: ResolvedThresholds;
    readonly now: Date;
  },
): Promise<CarryResult> {
  const { workspaceId, toCycleId, thresholds, now } = input;
  const kept = input.kept.filter((objective) =>
    CARRIED_DECISIONS.includes(objective.decision),
  );
  if (kept.length === 0) {
    return { drafts: 0, notCarried: [] };
  }

  const already = await tx
    .select({ from: goals.carriedFromGoalId })
    .from(goals)
    .where(
      includeDeleted(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, toCycleId),
        inArray(
          goals.carriedFromGoalId,
          kept.map((objective) => objective.goalId),
        ),
      ),
    );
  const carried = new Set(already.map((row) => row.from));
  const waiting = kept.filter((objective) => !carried.has(objective.goalId));
  if (waiting.length === 0) {
    return { drafts: 0, notCarried: [] };
  }

  const sources = await tx
    .select({
      id: goals.id,
      title: goals.title,
      description: goals.description,
      level: goals.level,
      kind: goals.kind,
      ownerKind: goals.ownerKind,
      spaceId: goals.spaceId,
      memberId: goals.memberId,
      championId: goals.championId,
      reviewerId: goals.reviewerId,
      weight: goals.weight,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        inArray(
          goals.id,
          waiting.map((objective) => objective.goalId),
        ),
      ),
    );
  const sourceKeyResults = await tx
    .select({
      goalId: keyResults.goalId,
      title: keyResults.title,
      unit: keyResults.unit,
      kind: keyResults.kind,
      doneAt: keyResults.doneAt,
      direction: keyResults.direction,
      indicatorType: keyResults.indicatorType,
      baselineValue: keyResults.baselineValue,
      targetValue: keyResults.targetValue,
      currentValue: keyResults.currentValue,
      ownerId: keyResults.ownerId,
      weight: keyResults.weight,
      kpiId: keyResults.kpiId,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        inArray(
          keyResults.goalId,
          waiting.map((objective) => objective.goalId),
        ),
      ),
    )
    .orderBy(asc(keyResults.position), asc(keyResults.createdAt));

  const people = new Set<string>();
  for (const source of sources) {
    people.add(source.championId);
    if (source.reviewerId) {
      people.add(source.reviewerId);
    }
  }
  for (const keyResult of sourceKeyResults) {
    if (keyResult.ownerId) {
      people.add(keyResult.ownerId);
    }
  }
  const active = new Set(
    people.size === 0
      ? []
      : (
          await tx
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(
              activeOnly(
                workspaceMembers,
                eq(workspaceMembers.workspaceId, workspaceId),
                inArray(workspaceMembers.id, [...people]),
                eq(workspaceMembers.status, "active"),
              ),
            )
        ).map((row) => row.id),
  );

  const running = await midCycleInTx(tx, workspaceId, toCycleId);
  const notCarried: string[] = [];
  const touched: { spaceId: string | null }[] = [];
  let drafts = 0;

  // In the order the decisions were listed, so the draft reads as the old
  // set did.
  for (const objective of waiting) {
    const source = sources.find((row) => row.id === objective.goalId);
    if (!source) {
      continue;
    }
    if (!active.has(source.championId)) {
      notCarried.push(source.title);
      continue;
    }
    const created = await createGoalInTx(tx, {
      workspaceId,
      title: source.title,
      description: source.description,
      cycleId: toCycleId,
      level: source.level,
      kind: source.kind,
      ownerKind: source.ownerKind,
      spaceId: source.spaceId,
      memberId: source.memberId,
      championId: source.championId,
      reviewerId:
        source.reviewerId && active.has(source.reviewerId)
          ? source.reviewerId
          : null,
      weight: asNumber(source.weight) ?? 1,
      addedMidCycleAt: running ? now : null,
      draftState: running ? "draft" : null,
      carriedFromGoalId: source.id,
    });

    for (const keyResult of sourceKeyResults.filter(
      (row) => row.goalId === source.id,
    )) {
      const start = carriedKeyResult({
        kind: keyResult.kind,
        doneAt: keyResult.doneAt,
        baselineValue: asNumber(keyResult.baselineValue) ?? 0,
        targetValue: asNumber(keyResult.targetValue),
        currentValue: asNumber(keyResult.currentValue) ?? 0,
      });
      if (!start) {
        continue;
      }
      await createKeyResultInTx(tx, {
        workspaceId,
        goalId: created.id,
        title: keyResult.title,
        unit: keyResult.unit,
        kind: start.kind,
        direction: keyResult.direction,
        indicatorType: keyResult.indicatorType,
        baselineValue: start.baselineValue,
        targetValue: start.targetValue,
        ownerId:
          keyResult.ownerId && active.has(keyResult.ownerId)
            ? keyResult.ownerId
            : null,
        weight: asNumber(keyResult.weight) ?? 1,
        kpiId: keyResult.kpiId,
        addedMidCycleAt: running ? now : null,
      });
    }

    await seedGoalFrequencyInTx(tx, {
      workspaceId,
      goalId: created.id,
      spaceId: source.spaceId,
    });
    // A draft waiting for a person owes no check-in until it goes live, as
    // `goals.create` has it.
    if (!running) {
      await stampFirstDue(tx, workspaceId, created.id, thresholds, now);
    }
    await recomputeForGoal(tx, workspaceId, created.id, thresholds, now);
    await recomputeUnitQualityInTx(tx, { workspaceId, goalId: created.id });
    touched.push({ spaceId: source.spaceId });
    drafts += 1;
  }

  // A new objective with no parent changes the alignment picture of the
  // cycle it joins, once per scope rather than once per objective.
  if (touched.length > 0) {
    for (const scope of scopesForGoal(touched.map((row) => row.spaceId))) {
      await recomputeAlignment(tx, { workspaceId, cycleId: toCycleId, scope });
    }
  }

  return { drafts, notCarried };
}
