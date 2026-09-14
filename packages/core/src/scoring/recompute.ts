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
  kpis,
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
import { asc, eq, type InferSelectModel, inArray, or, sql } from "drizzle-orm";
import { daysPastDue } from "../cadence/service.ts";
import { latestPublishedStatus } from "../check-ins/service.ts";
import { workspaceTimeZone } from "../cycles/service.ts";
import { recomputeKpi } from "../kpis/service.ts";
import type { OperationTx } from "../operations/operation.ts";

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
  /** Recovering KPIs whose effective health followed a goal that moved. */
  readonly kpisWritten: number;
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
  // The cycle is still resolved for a goal scope, because it is the forecast
  // horizon. It is no longer what decides which rows are loaded.
  let cycleId = scope.cycleId ?? null;
  const onlyGoalId = scope.cycleId ? null : (scope.goalId ?? null);

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
      return {
        goalsWritten: 0,
        keyResultsWritten: 0,
        kpisWritten: 0,
        diagnostics: [],
      };
    }
    cycleId = goal.cycleId;
  }

  if (!cycleId && !onlyGoalId) {
    return {
      goalsWritten: 0,
      keyResultsWritten: 0,
      kpisWritten: 0,
      diagnostics: [],
    };
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

  // **One goal changing loads its own branch, not its whole cycle** (P7-T02).
  //
  // A cycle scope is a cycle scope: closing or publishing one really does move
  // every goal in it. A single check-in does not, and this used to treat the
  // two the same. On §13.1's dataset, where a cycle holds 10,000 goals,
  // publishing one check-in read 10,000 goals and 10,000 key results and
  // cascaded the lot: one second of work for a change that can move a handful
  // of rows, and at twenty concurrent members it took the whole run down to
  // 15.8 calls a second from 46.6.
  //
  // What a change to one goal can move is that goal and the goals above it,
  // because progress rolls upward. Agung chose narrowing this on 10 September
  // 2026 over deferring the recompute to a job.
  const scoped = onlyGoalId
    ? await loadGoalBranch(tx, workspaceId, onlyGoalId)
    : await loadCycleGraph(tx, workspaceId, cycleId as string);

  if (scoped.write.length === 0) {
    return {
      goalsWritten: 0,
      keyResultsWritten: 0,
      kpisWritten: 0,
      diagnostics: [],
    };
  }

  const goalRows = scoped.write;
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
      forecast: keyResults.forecast,
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

  // Decision D-4 and design §10: a linked key result reads the KPI's **real**
  // achievement, clamped to 0 to 100, and never the effective figure. A
  // recovery key result reading its own KPI's effective health would feed its
  // own progress back into itself.
  const linkedKpiIds = [
    ...new Set(
      keyResultRows
        .map((row) => row.kpiId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const kpiAchievementById = new Map<string, number>();
  if (linkedKpiIds.length > 0) {
    const linked = await tx
      .select({ id: kpis.id, achievementPct: kpis.achievementPct })
      .from(kpis)
      .where(
        activeOnly(
          kpis,
          eq(kpis.workspaceId, workspaceId),
          inArray(kpis.id, linkedKpiIds),
        ),
      );
    for (const row of linked) {
      if (row.achievementPct !== null) {
        kpiAchievementById.set(
          row.id,
          Math.min(100, Math.max(0, Number(row.achievementPct))),
        );
      }
    }
  }

  for (const row of keyResultRows) {
    const baseline = asNumber(row.baselineValue);
    const target = asNumber(row.targetValue);
    const current = asNumber(row.currentValue);
    const direction = row.direction;

    // A KPI with no achievement at all has measured nothing, so the key result
    // keeps the progress it had rather than dropping to zero: a KPI nobody has
    // recorded is unmeasured, not failing.
    const progress = row.kpiId
      ? (kpiAchievementById.get(row.kpiId) ?? asNumber(row.progressPct))
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

  const cascadeInput: CascadeGoal[] = [
    ...goalRows.map((row) => ({
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
    })),
    // The boundary siblings, contributing the progress they already have. A
    // cycle scope has none of these: it loaded everything.
    ...scoped.settled.map((row) => ({
      id: row.id,
      weight: asNumber(row.weight),
      parentGoalId: row.parentGoalId,
      parentKeyResultId: row.parentKeyResultId,
      keyResults: [],
      settledProgressPct: asNumber(row.progressPct),
    })),
  ];

  const cascade = cascadeProgress(cascadeInput);
  const graceDays = thresholds["cadence.stalenessGraceDays"];
  // Staleness is counted in the workspace's calendar, not in absolute hours: a
  // goal due at 23:59 local is one day overdue at any hour of the next day.
  const timeZone = await workspaceTimeZone(tx, workspaceId);
  // Health rule 3: the latest published check-in's status. It arrived with
  // check-ins at P3-T07; before that the precedence answered on rules 1, 2 and 4.
  const latestStatus = await latestPublishedStatus(tx, workspaceId, goalIds);

  // **Only the rows that moved, and all of them in one statement** (P7-T02).
  //
  // This wrote every row in the scope, one statement each. The scope is the
  // cycle, so publishing one check-in on §13.1's dataset issued 20,034
  // statements and took 8.9 seconds on its own; twenty members doing it at
  // once took 47 seconds at the median and deadlocked nineteen times in
  // thirty. Two things were wrong with that and both are fixed here.
  //
  // A recompute is a cascade over a whole cycle and almost nothing in it
  // changes: one check-in moves the goal it was published on and the goals
  // above it. Comparing against what is stored is what turns ten thousand
  // writes into a handful, and it corrects a second thing on the way, which
  // is that `updated_at` was being bumped on every goal in the cycle every
  // time anybody checked in anywhere.
  const keyResultUpdates = keyResultRows
    .map((row) => {
      const progress = keyResultProgressById.get(row.id) ?? 0;
      const forecast = forecastById.get(row.id) ?? null;
      return { id: row.id, progress, forecast, stored: row };
    })
    .filter(
      (update) =>
        !sameNumber(update.stored.progressPct, update.progress) ||
        !sameJson(update.stored.forecast, update.forecast),
    );

  const goalUpdates = goalRows
    .map((row) => {
      const progress = cascade.goals.get(row.id) ?? 0;
      const health = healthFor(
        row,
        graceDays,
        now,
        timeZone,
        latestStatus.get(row.id) ?? null,
      );
      return { id: row.id, progress, health, stored: row };
    })
    .filter(
      (update) =>
        !sameNumber(update.stored.progressPct, update.progress) ||
        update.stored.health !== update.health,
    );

  const keyResultsWritten = await writeKeyResults(tx, keyResultUpdates, now);
  const goalsWritten = await writeGoals(tx, goalUpdates, now);

  // METHOD.md 6.5: a recovering KPI's displayed health moves with its recovery
  // goal's progress, so the goal that just moved has to push it. Here rather
  // than in a write path, because progress changes through several of them and
  // every one ends up here. Same argument P3-T05 made for the cascade itself.
  const recovering =
    goalIds.length === 0
      ? []
      : await tx
          .select({ id: kpis.id })
          .from(kpis)
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, workspaceId),
              inArray(kpis.recoveryGoalId, goalIds),
            ),
          );
  let kpisWritten = 0;
  for (const kpi of recovering) {
    // The two transaction types are the same object at run time and differ
    // only in a schema type parameter neither side uses, so the cast goes
    // through `unknown`: TypeScript cannot see that `Record<string, never>`
    // and an inferred schema describe the same client.
    await recomputeKpi(tx as unknown as OperationTx, workspaceId, kpi.id, now);
    kpisWritten += 1;
  }

  return {
    goalsWritten,
    keyResultsWritten,
    kpisWritten,
    diagnostics: cascade.diagnostics,
  };
}

/** Exactly the columns `GOAL_COLUMNS` selects, typed from the table. */
type GoalRow = Pick<
  InferSelectModel<typeof goals>,
  | "id"
  | "cycleId"
  | "weight"
  | "parentGoalId"
  | "parentKeyResultId"
  | "closedAt"
  | "successStatus"
  | "nextCheckInAt"
  | "health"
  | "progressPct"
>;

/**
 * What one recompute loads: the rows it may write, and the rows it only needs
 * in order to get those right.
 */
interface ScopedGraph {
  /** Loaded whole, recomputed, and written when the answer moved. */
  readonly write: GoalRow[];
  /**
   * Loaded as a boundary: a sibling whose own subtree was not loaded, standing
   * in for that subtree with its stored progress. Never written.
   */
  readonly settled: GoalRow[];
}

/** The whole cycle, plus anything aligned beneath it from outside. */
async function loadCycleGraph<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycleId: string,
): Promise<ScopedGraph> {
  const seed = await tx
    .select(GOAL_COLUMNS)
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
      ),
    );
  if (seed.length === 0) {
    return { write: [], settled: [] };
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

  return { write: [...loaded.values()], settled: [] };
}

/**
 * One goal's branch: the goal, every goal above it, and the siblings each of
 * those rolls up with.
 *
 * **Why upwards only.** Progress rolls from a child into its parent, never the
 * other way, so a change to one goal cannot move anything beneath it. The
 * goals above it move, and to recompute one of those correctly every child it
 * rolls up must contribute. Those siblings come in as settled boundaries with
 * the progress they already have, because their own subtrees are not loaded
 * and recomputing them from half a graph would read them as lower than they
 * are.
 */
async function loadGoalBranch<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalId: string,
): Promise<ScopedGraph> {
  const [start] = await tx
    .select(GOAL_COLUMNS)
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    )
    .limit(1);
  if (!start) {
    return { write: [], settled: [] };
  }

  // Up the chain. `parent_key_result_id` names a key result, so the step is to
  // the goal that owns it. Bounded at 32 like the cascade's own walk, and a
  // loop cannot spin because a repeat ends it.
  const write = new Map<string, GoalRow>([[start.id, start]]);
  let cursor: GoalRow | undefined = start;
  for (let depth = 0; depth < 32 && cursor; depth += 1) {
    let parentId: string | null = cursor.parentGoalId;
    if (!parentId && cursor.parentKeyResultId) {
      const [owner] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, cursor.parentKeyResultId),
          ),
        )
        .limit(1);
      parentId = owner?.goalId ?? null;
    }
    if (!parentId || write.has(parentId)) {
      break;
    }
    const [parent]: GoalRow[] = await tx
      .select(GOAL_COLUMNS)
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, workspaceId),
          eq(goals.id, parentId),
        ),
      )
      .limit(1);
    if (!parent) {
      break;
    }
    write.set(parent.id, parent);
    cursor = parent;
  }

  // The siblings. Every goal that rolls into one of these, by either pointer,
  // and is not already one of them.
  const branchIds = [...write.keys()];
  const ownedKeyResults = await tx
    .select({ id: keyResults.id })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        inArray(keyResults.goalId, branchIds),
      ),
    );
  const children = await tx
    .select(GOAL_COLUMNS)
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        ownedKeyResults.length === 0
          ? inArray(goals.parentGoalId, branchIds)
          : or(
              inArray(goals.parentGoalId, branchIds),
              inArray(
                goals.parentKeyResultId,
                ownedKeyResults.map((row) => row.id),
              ),
            ),
      ),
    );

  return {
    write: [...write.values()],
    settled: children.filter((row) => !write.has(row.id)),
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
  // Read so the write can be skipped when the answer has not moved (P7-T02).
  progressPct: goals.progressPct,
} as const;

/**
 * How many rows one bulk update carries.
 *
 * Three parameters a row plus the timestamp, against Postgres's ceiling of
 * 65,535 for one statement. Five thousand leaves room and keeps a statement
 * small enough to read in a log.
 */
const WRITE_BATCH = 5_000;

/** Numeric columns come back as strings, so "0" and 0 are the same answer. */
function sameNumber(stored: string | number | null, computed: number): boolean {
  return asNumber(stored) === computed;
}

/** A forecast is a small object or nothing, so comparing the text is enough. */
function sameJson(stored: unknown, computed: unknown): boolean {
  return JSON.stringify(stored ?? null) === JSON.stringify(computed ?? null);
}

/**
 * Writes the key results that moved, in batches of one statement each.
 *
 * Ordered by id, because two recomputes touching one cycle take their row
 * locks in the same order that way and cannot deadlock against each other.
 */
async function writeKeyResults<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  updates: readonly {
    id: string;
    progress: number;
    forecast: Record<string, unknown> | null;
  }[],
  now: Date,
): Promise<number> {
  const ordered = [...updates].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let start = 0; start < ordered.length; start += WRITE_BATCH) {
    const batch = ordered.slice(start, start + WRITE_BATCH);
    const values = sql.join(
      batch.map(
        (row) =>
          sql`(${row.id}::uuid, ${String(row.progress)}::numeric, ${row.forecast === null ? null : JSON.stringify(row.forecast)}::jsonb)`,
      ),
      sql`, `,
    );
    // openokr:allow-mutation: runs on the transaction the calling Operation
    // opened, so the derived columns commit with the change that moved them.
    await tx.execute(sql`
      update key_results as k
         set progress_pct = v.progress,
             forecast = v.forecast,
             updated_at = ${now}
        from (values ${values}) as v(id, progress, forecast)
       where k.id = v.id
         and k.deleted_at is null
    `);
  }
  return ordered.length;
}

/** The same, for goals. */
async function writeGoals<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  updates: readonly { id: string; progress: number; health: GoalHealth }[],
  now: Date,
): Promise<number> {
  const ordered = [...updates].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let start = 0; start < ordered.length; start += WRITE_BATCH) {
    const batch = ordered.slice(start, start + WRITE_BATCH);
    const values = sql.join(
      batch.map(
        (row) =>
          sql`(${row.id}::uuid, ${String(row.progress)}::numeric, ${row.health}::text)`,
      ),
      sql`, `,
    );
    // openokr:allow-mutation: same transaction as above.
    await tx.execute(sql`
      update goals as g
         set progress_pct = v.progress,
             health = v.health,
             updated_at = ${now}
        from (values ${values}) as v(id, progress, health)
       where g.id = v.id
         and g.deleted_at is null
    `);
  }
  return ordered.length;
}

/**
 * §3.5's precedence, over the rows this build has.
 *
 * All four rules answer now. The one worth restating is that rule 2 sits above
 * rule 3: a goal whose last check-in said `on_track` reads `outdated` once its
 * grace passes, which is the plan's own acceptance criterion.
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
  latestStatus: "on_track" | "caution" | "off_track" | null,
): GoalHealth {
  return goalHealth({
    closed: row.closedAt !== null,
    successStatus: row.successStatus,
    latestStatus,
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
