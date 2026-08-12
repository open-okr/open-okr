/**
 * The one recompute entry point (TECHNICAL-PLAN §6.2, P3-T05).
 *
 * `packages/method` does the arithmetic. This loads the graph it needs, calls it
 * once, and writes the derived columns back. Nothing else in the product writes
 * `progress_pct`, `health`, `forecast` or a key result's own `progress_pct`.
 *
 * **It runs inside the writing transaction, not in a job.** The task lists an
 * outbox-driven invalidation job, and there is no relay host running in the
 * application yet: a topic with no consumer is a pending row nobody drains. Doing
 * it in the same transaction is also the stronger guarantee, because there is no
 * window where a page shows a number the rows no longer support. When the relay
 * host lands, the same function is what the job will call.
 *
 * **The scope is the goal's whole tree, not one goal.** A key result moving
 * changes its goal, its goal's parent, and every level above that. Recomputing
 * one row would leave the levels above it stale, which is the failure mode the
 * cascade exists to prevent.
 */
import {
  activeOnly,
  cycles,
  goals,
  keyResults,
  keyResultValues,
  type WorkspaceTx,
} from "@openokr/db";
import {
  type CascadeGoal,
  cascadeProgress,
  type GoalHealth,
  goalHealth,
  keyResultProgress,
  type ResolvedThresholds,
  trendForecast,
} from "@openokr/method";
import { asc, eq, inArray, or } from "drizzle-orm";
import { daysPastDue } from "../cadence/service.ts";
import { workspaceTimeZone } from "../cycles/service.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

const asNumber = (value: string | number | null): number => {
  if (value === null) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface RecomputeResult {
  readonly goalsWritten: number;
  readonly keyResultsWritten: number;
  /** `cycle:<child>-><parent>` for every alignment loop the cascade broke. */
  readonly diagnostics: readonly string[];
}

interface RecomputeScope {
  /** Every goal in this cycle, plus anything aligned beneath them. */
  readonly cycleId?: string;
  /** This goal's cycle, or the goal alone when it is contextual. */
  readonly goalId?: string;
}

/**
 * Recomputes progress, health and the forecast for a scope, and writes them.
 *
 * Not exported: callers say what changed, through the two wrappers below, and the
 * scope resolution stays one decision made in one place.
 *
 * `now` is an argument for the same reason the engine takes one: a scoring result
 * that depends on a hidden clock cannot be tested, and the staleness rule is the
 * one place the clock changes the answer.
 */
async function recomputeScoring<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  scope: RecomputeScope,
  thresholds: ResolvedThresholds,
  now: Date,
): Promise<RecomputeResult> {
  let cycleId = scope.cycleId ?? null;
  let onlyGoalId: string | null = null;

  if (!cycleId && scope.goalId) {
    const [goal] = await tx
      .select({ cycleId: goals.cycleId })
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, workspaceId),
          eq(goals.id, scope.goalId),
        ),
      )
      .limit(1);
    if (!goal) {
      return { goalsWritten: 0, keyResultsWritten: 0, diagnostics: [] };
    }
    cycleId = goal.cycleId;
    if (!cycleId) {
      // A contextual goal has no cycle to gather siblings from, so its own tree
      // is the scope.
      onlyGoalId = scope.goalId;
    }
  }

  if (!cycleId && !onlyGoalId) {
    return { goalsWritten: 0, keyResultsWritten: 0, diagnostics: [] };
  }

  // The cycle's own bounds, which are the forecast horizon.
  const [cycle] = cycleId
    ? await tx
        .select({ endsOn: cycles.endsOn, startsOn: cycles.startsOn })
        .from(cycles)
        .where(
          activeOnly(
            cycles,
            eq(cycles.workspaceId, workspaceId),
            eq(cycles.id, cycleId),
          ),
        )
        .limit(1)
    : [];

  const seed = cycleId
    ? await tx
        .select(GOAL_COLUMNS)
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.cycleId, cycleId),
          ),
        )
    : await tx
        .select(GOAL_COLUMNS)
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, onlyGoalId as string),
          ),
        );

  if (seed.length === 0) {
    return { goalsWritten: 0, keyResultsWritten: 0, diagnostics: [] };
  }

  // Children aligned from outside the cycle still roll into it, so the graph is
  // widened until nothing new appears. Bounded by the number of goals, and in
  // practice by the depth of the cascade.
  const loaded = new Map(seed.map((row) => [row.id, row]));
  let frontier = seed.map((row) => row.id);
  for (let depth = 0; depth < 32 && frontier.length > 0; depth += 1) {
    const owned = await tx
      .select({ id: keyResults.id })
      .from(keyResults)
      .where(
        activeOnly(
          keyResults,
          eq(keyResults.workspaceId, workspaceId),
          inArray(keyResults.goalId, frontier),
        ),
      );

    const children = await tx
      .select(GOAL_COLUMNS)
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, workspaceId),
          owned.length === 0
            ? inArray(goals.parentGoalId, frontier)
            : or(
                inArray(goals.parentGoalId, frontier),
                inArray(
                  goals.parentKeyResultId,
                  owned.map((row) => row.id),
                ),
              ),
        ),
      );

    frontier = [];
    for (const child of children) {
      if (loaded.has(child.id)) {
        continue;
      }
      loaded.set(child.id, child);
      frontier.push(child.id);
    }
  }

  const goalRows = [...loaded.values()];
  const goalIds = goalRows.map((row) => row.id);

  const keyResultRows = await tx
    .select({
      id: keyResults.id,
      goalId: keyResults.goalId,
      direction: keyResults.direction,
      baselineValue: keyResults.baselineValue,
      targetValue: keyResults.targetValue,
      currentValue: keyResults.currentValue,
      weight: keyResults.weight,
      kpiId: keyResults.kpiId,
      dueOn: keyResults.dueOn,
      progressPct: keyResults.progressPct,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        inArray(keyResults.goalId, goalIds),
      ),
    );

  // The forecast window: every recorded point, oldest first. Decision D-5 scopes
  // it to the cycle; the values of a key result belong to the cycle its goal sits
  // in, so the key result filter is the scope.
  const history =
    keyResultRows.length === 0
      ? []
      : await tx
          .select({
            keyResultId: keyResultValues.keyResultId,
            value: keyResultValues.value,
            at: keyResultValues.at,
          })
          .from(keyResultValues)
          .where(
            activeOnly(
              keyResultValues,
              eq(keyResultValues.workspaceId, workspaceId),
              inArray(
                keyResultValues.keyResultId,
                keyResultRows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(asc(keyResultValues.at));

  const pointsByKeyResult = new Map<string, { at: number; value: number }[]>();
  for (const row of history) {
    const list = pointsByKeyResult.get(row.keyResultId) ?? [];
    list.push({ at: new Date(row.at).getTime(), value: asNumber(row.value) });
    pointsByKeyResult.set(row.keyResultId, list);
  }

  // Key result progress and forecast first: the cascade reads the numbers this
  // pass produces.
  const keyResultProgressById = new Map<string, number>();
  const forecastById = new Map<
    string,
    { projected: number; trendingOffTrack: boolean } | null
  >();

  for (const row of keyResultRows) {
    const baseline = asNumber(row.baselineValue);
    const target = asNumber(row.targetValue);
    const current = asNumber(row.currentValue);
    const direction = row.direction;

    // A KPI-linked key result reads the KPI's achievement (decision D-4). KPIs
    // arrive at P3-T12, so until then a linked key result keeps the progress it
    // already had rather than being recomputed from a value nobody owns.
    const progress = row.kpiId
      ? asNumber(row.progressPct)
      : keyResultProgress({ direction, baseline, target, current });
    keyResultProgressById.set(row.id, progress);

    const points = pointsByKeyResult.get(row.id) ?? [];
    const horizonDate = cycle?.endsOn ?? row.dueOn;
    forecastById.set(
      row.id,
      horizonDate
        ? trendForecast(
            points,
            new Date(`${horizonDate}T00:00:00Z`).getTime(),
            {
              direction,
              baseline,
              target,
            },
          )
        : null,
    );
  }

  const cascadeInput: CascadeGoal[] = goalRows.map((row) => ({
    id: row.id,
    weight: asNumber(row.weight),
    parentGoalId: row.parentGoalId,
    parentKeyResultId: row.parentKeyResultId,
    keyResults: keyResultRows
      .filter((keyResult) => keyResult.goalId === row.id)
      .map((keyResult) => ({
        id: keyResult.id,
        weight: asNumber(keyResult.weight),
        progressPct: keyResultProgressById.get(keyResult.id) ?? 0,
      })),
  }));

  const cascade = cascadeProgress(cascadeInput);
  const graceDays = thresholds["cadence.stalenessGraceDays"];
  // Staleness is counted in the workspace's calendar, not in absolute hours: a
  // goal due at 23:59 local is one day overdue at any hour of the next day.
  const timeZone = await workspaceTimeZone(tx, workspaceId);

  let keyResultsWritten = 0;
  for (const row of keyResultRows) {
    const progress = keyResultProgressById.get(row.id) ?? 0;
    const forecast = forecastById.get(row.id) ?? null;
    // openokr:allow-mutation: runs on the transaction the calling Operation
    // opened, so the derived columns commit with the change that moved them.
    await tx
      .update(keyResults)
      .set({
        progressPct: String(progress),
        forecast: forecast ?? null,
        updatedAt: now,
      })
      .where(activeOnly(keyResults, eq(keyResults.id, row.id)));
    keyResultsWritten += 1;
  }

  let goalsWritten = 0;
  for (const row of goalRows) {
    const progress = cascade.goals.get(row.id) ?? 0;
    const health = healthFor(row, graceDays, now, timeZone);
    // openokr:allow-mutation: same transaction as above.
    await tx
      .update(goals)
      .set({
        progressPct: String(progress),
        health,
        updatedAt: now,
      })
      .where(activeOnly(goals, eq(goals.id, row.id)));
    goalsWritten += 1;
  }

  return {
    goalsWritten,
    keyResultsWritten,
    diagnostics: cascade.diagnostics,
  };
}

const GOAL_COLUMNS = {
  id: goals.id,
  cycleId: goals.cycleId,
  weight: goals.weight,
  parentGoalId: goals.parentGoalId,
  parentKeyResultId: goals.parentKeyResultId,
  closedAt: goals.closedAt,
  successStatus: goals.successStatus,
  nextCheckInAt: goals.nextCheckInAt,
  health: goals.health,
} as const;

/**
 * §3.5's precedence, over the rows this build has.
 *
 * The published check-in's status is the third rule and check-ins arrive at
 * P3-T07, so `latestStatus` is null here. That is honest rather than convenient:
 * rules 1, 2 and 4 answer completely on their own, and a goal past its grace
 * reads `outdated` today for the same reason it will then.
 */
function healthFor(
  row: {
    closedAt: Date | string | null;
    successStatus: "achieved" | "missed" | null;
    nextCheckInAt: Date | string | null;
  },
  graceDays: number,
  now: Date,
  timeZone: string,
): GoalHealth {
  return goalHealth({
    closed: row.closedAt !== null,
    successStatus: row.successStatus,
    latestStatus: null,
    daysPastDue: daysPastDue(row.nextCheckInAt, now, timeZone),
    graceDays,
  });
}

/** Every goal whose derived columns a change to one goal can move. */
export async function recomputeForGoal<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalId: string,
  thresholds: ResolvedThresholds,
  now: Date = new Date(),
): Promise<RecomputeResult> {
  return recomputeScoring(tx, workspaceId, { goalId }, thresholds, now);
}

/** The whole cycle, which is what a publish or an archive moves. */
export async function recomputeForCycle<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycleId: string,
  thresholds: ResolvedThresholds,
  now: Date = new Date(),
): Promise<RecomputeResult> {
  return recomputeScoring(tx, workspaceId, { cycleId }, thresholds, now);
}
