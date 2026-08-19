/**
 * Server-side quality evaluation (P4-T02a).
 *
 * Every goal and key result write recomputes the goal's verdicts and stores
 * them, so `goals.quality_score` and `goals.quality_flags` are never a stale
 * answer to an older version of the text. The columns already existed from
 * P3-T04; nothing wrote to them until now.
 *
 * **It runs inside the calling Operation's transaction**, not after it. A score
 * written by a second transaction can disagree with the row it describes for as
 * long as that transaction takes, and a reader in between sees a goal whose
 * flags belong to text that no longer exists.
 *
 * **Strictness is applied here, not at the surface.** METHOD.md §4 says strict
 * mode turns every warn into a fail, and a workspace that has chosen it has
 * chosen a harder standard rather than a redder screen. Applying it only in the
 * browser would leave the stored score describing a standard nobody asked for.
 *
 * Two of §4.2's checks can never fail against stored data, and that is the
 * schema's doing rather than an omission: `key_results.indicator_type` and
 * `direction` are both `not null`, so KR-4's untagged row and KR-7's missing
 * direction cannot be stored. They stay in the catalogue because the Draft
 * Coach evaluates text before it is a row, and there they fire.
 */
import { activeOnly, goals, keyResults, type WorkspaceTx } from "@openokr/db";
import {
  applyStrictness,
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultInput,
  type QualityVerdict,
  type ResolvedThresholds,
  strengthScore,
} from "@openokr/method";
import { and, eq, isNull, ne } from "drizzle-orm";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";

/**
 * The workspace's resolved thresholds, read inside the transaction doing the
 * write. Loading them outside would let an admin change strictness between the
 * read and the write, and the row would then carry a score from neither
 * setting.
 *
 * `readRhythmRow` is the one reader of that row, and a workspace with no row
 * resolves to the canon defaults. That is the whole point of §11 shipping
 * defaults: nothing has to be configured before the product works.
 */
async function loadThresholdsInTx(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<ResolvedThresholds> {
  return resolveRhythm(await readRhythmRow(tx, workspaceId)).thresholds;
}

export interface GoalQuality {
  /** The §4 strength score, 0 to 100, or null when nothing was evaluable. */
  readonly score: number | null;
  /** The ids of every check that did not pass, objective checks first. */
  readonly flags: readonly string[];
  /** Per key result, the ids of the checks it tripped. */
  readonly keyResultFlags: ReadonlyMap<string, readonly string[]>;
}

/** A verdict that is not a pass is a flag. `todo` counts: it has not passed. */
const flagsOf = (verdicts: readonly QualityVerdict[]): string[] =>
  verdicts.filter((entry) => entry.status !== "pass").map((entry) => entry.id);

/**
 * Evaluate one goal and its key results, and store the answer on both.
 *
 * Returns what it wrote, so a caller that needs to report the score does not
 * read the row back.
 */
export async function recomputeGoalQualityInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly goalId: string;
    /** Passed in when the caller already loaded them, saving a query. */
    readonly thresholds?: ResolvedThresholds;
  },
): Promise<GoalQuality | null> {
  const thresholds =
    input.thresholds ?? (await loadThresholdsInTx(tx, input.workspaceId));

  const [goal] = await tx
    .select({
      id: goals.id,
      title: goals.title,
      cycleId: goals.cycleId,
      timeframe: goals.timeframe,
      championId: goals.championId,
      reviewerId: goals.reviewerId,
      level: goals.level,
      ownerKind: goals.ownerKind,
      spaceId: goals.spaceId,
      memberId: goals.memberId,
    })
    .from(goals)
    .where(activeOnly(goals, eq(goals.id, input.goalId)))
    .limit(1);
  if (!goal) {
    // Deleted between the write and this call. Nothing to describe.
    return null;
  }

  // OBJ-5 counts the objectives in this goal's own unit, including itself. The
  // unit is the owning space, or the owning member for a personal goal, which
  // is how §4.1's cap reads: a count a team can hold in mind, not a workspace
  // total nobody feels.
  const unitFilter =
    goal.ownerKind === "space" && goal.spaceId
      ? eq(goals.spaceId, goal.spaceId)
      : goal.ownerKind === "member" && goal.memberId
        ? eq(goals.memberId, goal.memberId)
        : isNull(goals.spaceId);
  const unit = await tx
    .select({ id: goals.id })
    .from(goals)
    .where(
      activeOnly(
        goals,
        and(eq(goals.level, goal.level), unitFilter, isNull(goals.closedAt)),
      ),
    );

  const rows = await tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      baselineValue: keyResults.baselineValue,
      targetValue: keyResults.targetValue,
      dueOn: keyResults.dueOn,
      ownerId: keyResults.ownerId,
      indicatorType: keyResults.indicatorType,
      direction: keyResults.direction,
      confidence: keyResults.confidence,
    })
    .from(keyResults)
    .where(activeOnly(keyResults, eq(keyResults.goalId, input.goalId)));

  const set: KeyResultInput[] = rows.map((row) => ({
    text: row.title,
    baseline: Number(row.baselineValue),
    target: Number(row.targetValue),
    dueOn: row.dueOn,
    ownerId: row.ownerId,
    indicatorType: row.indicatorType,
    direction: row.direction,
    confidence: row.confidence === null ? null : Number(row.confidence),
  }));

  const strictness = thresholds["quality.coachStrictness"];
  const objective = applyStrictness(
    evaluateObjective(
      {
        title: goal.title,
        hasCycle: goal.cycleId !== null,
        hasTimeframe: goal.timeframe !== null,
        championId: goal.championId,
        reviewerId: goal.reviewerId,
        objectivesInUnit: Math.max(unit.length, 1),
        level: goal.level,
      },
      thresholds,
    ),
    strictness,
  );
  const keyResultVerdicts = applyStrictness(
    evaluateKeyResults({ keyResults: set }, thresholds),
    strictness,
  );

  const score = strengthScore([...objective, ...keyResultVerdicts]);
  const flags = [...flagsOf(objective), ...flagsOf(keyResultVerdicts)];

  // Which key result tripped which check, so a surface can put the flag beside
  // the row rather than beside the objective.
  const perKeyResult = new Map<string, string[]>();
  for (const verdict of keyResultVerdicts) {
    if (verdict.status === "pass") {
      continue;
    }
    for (const index of verdict.keyResults) {
      const row = rows[index];
      if (!row) {
        continue;
      }
      const carried = perKeyResult.get(row.id) ?? [];
      carried.push(verdict.id);
      perKeyResult.set(row.id, carried);
    }
  }

  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so the goal, its score and that Operation's audit row commit
  // together or not at all.
  await tx
    .update(goals)
    .set({ qualityScore: score, qualityFlags: flags })
    .where(activeOnly(goals, eq(goals.id, input.goalId)));

  for (const row of rows) {
    const carried = perKeyResult.get(row.id) ?? [];
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(keyResults)
      .set({ qualityFlags: carried })
      .where(activeOnly(keyResults, eq(keyResults.id, row.id)));
  }

  return { score, flags, keyResultFlags: perKeyResult };
}

/**
 * Recompute every goal in a unit after one of them moved.
 *
 * OBJ-5 is a property of the set rather than of one objective, so adding a
 * fourth objective to a team changes the verdict on the three that were already
 * there. Storing the score on only the goal being written would leave the other
 * three claiming a count that is no longer true.
 */
export async function recomputeUnitQualityInTx(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly goalId: string },
): Promise<void> {
  const thresholds = await loadThresholdsInTx(tx, input.workspaceId);
  await recomputeGoalQualityInTx(tx, { ...input, thresholds });

  const [goal] = await tx
    .select({
      level: goals.level,
      ownerKind: goals.ownerKind,
      spaceId: goals.spaceId,
      memberId: goals.memberId,
    })
    .from(goals)
    .where(activeOnly(goals, eq(goals.id, input.goalId)))
    .limit(1);
  if (!goal) {
    return;
  }

  const unitFilter =
    goal.ownerKind === "space" && goal.spaceId
      ? eq(goals.spaceId, goal.spaceId)
      : goal.ownerKind === "member" && goal.memberId
        ? eq(goals.memberId, goal.memberId)
        : isNull(goals.spaceId);
  const siblings = await tx
    .select({ id: goals.id })
    .from(goals)
    .where(
      activeOnly(
        goals,
        and(
          eq(goals.level, goal.level),
          unitFilter,
          isNull(goals.closedAt),
          ne(goals.id, input.goalId),
        ),
      ),
    );

  for (const sibling of siblings) {
    await recomputeGoalQualityInTx(tx, {
      workspaceId: input.workspaceId,
      goalId: sibling.id,
      thresholds,
    });
  }
}
