import { activeOnly, goals, keyResults, kpis } from "@openokr/db";
import { eq, inArray, isNull } from "drizzle-orm";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { asNumber, recordValueInTx } from "../goals/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { recomputeForGoal } from "../scoring/recompute.ts";
import { latestKpiReading } from "./service.ts";

/**
 * The key results that read a KPI, kept in step with it (TECHNICAL-PLAN §6.2,
 * design `p3-t00-kpi-engine.md` §10, completeness review M-07).
 *
 * "A KPI-backed key result reads the KPI's latest achievement." The scoring
 * cascade has always read it, but only when something else made it run, so a
 * value typed into the KPI grid moved the KPI and left every key result that
 * reads it, and every goal above those, where they were.
 *
 * **Same transaction, not the outbox.** The design first sent this fan-out
 * through the outbox. There is still no relay draining one, so it runs in the
 * writing Operation, which is the call P3-T05 made for the scoring cascade and
 * the stronger guarantee besides: no page can show a KPI that moved beside a
 * key result that did not.
 *
 * **Whoever records the KPI moves goals they may not see.** A support guest
 * at edit can record one and cannot read a single goal. The goals still
 * follow, because one measure with two numbers depending on who wrote it would
 * be worse, and the recorder learns nothing: this writes no activity, returns
 * nothing about a goal, and the only activity row is the KPI's own.
 *
 * **No second formula.** The progress comes from `recomputeForGoal`, which
 * reads the KPI's real achievement (decision D-4). What this adds is the
 * current value, which the design says a linked key result also reads from the
 * KPI, written through `recordValueInTx` so it is history like any other
 * movement.
 */

/**
 * The KPI a key result is about to read, and the value it last reported.
 *
 * KPIs are read at the workspace floor: every member who can open the grid
 * sees every row in it (`actions/kpis.ts`), and the caller has already been
 * admitted to the workspace. So "may this member read it" is "does it exist,
 * here, and is it live". Checked by hand, because the foreign key accepts a
 * KPI from another workspace: a key check does not see row-level security.
 */
export async function readLinkableKpi(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
): Promise<{ readonly reading: number | null }> {
  const [kpi] = await tx
    .select({ id: kpis.id })
    .from(kpis)
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    )
    .limit(1);
  if (!kpi) {
    throw new OperationError("not_found", "No such KPI.");
  }
  const latest = await latestKpiReading(tx, workspaceId, kpiId);
  return { reading: latest?.actualValue ?? null };
}

export interface FollowedKpis {
  /** Key results given a new value because the KPI's reading moved. */
  readonly keyResultsMoved: number;
  /** Goals recomputed, each with the goals above it. */
  readonly goalsRecomputed: number;
}

/**
 * Moves every key result that reads one of these KPIs, then its goal and the
 * goals above it.
 *
 * Call it after the KPIs themselves are recomputed, because the progress it
 * sets off reads their stored achievement.
 *
 * **A closed goal is left as it was closed.** Its key results take no new
 * values, because a closed goal is a record of how the cycle ended and a KPI
 * reading from next quarter does not belong in it.
 */
export async function followKpisInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly kpiIds: readonly string[];
    readonly authorMemberId: string | null;
  },
): Promise<FollowedKpis> {
  const kpiIds = [...new Set(input.kpiIds)];
  if (kpiIds.length === 0) {
    return { keyResultsMoved: 0, goalsRecomputed: 0 };
  }

  // Indexed on `(workspace_id, kpi_id)` where a KPI is set, so a KPI nobody
  // reads costs the grid one cheap lookup and nothing more.
  const reading = await tx
    .select({
      id: keyResults.id,
      goalId: keyResults.goalId,
      kpiId: keyResults.kpiId,
      currentValue: keyResults.currentValue,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        inArray(keyResults.kpiId, kpiIds),
        isNull(goals.deletedAt),
        isNull(goals.closedAt),
      ),
    );
  if (reading.length === 0) {
    return { keyResultsMoved: 0, goalsRecomputed: 0 };
  }

  const latest = new Map<string, number | null>();
  for (const kpiId of new Set(reading.map((row) => row.kpiId as string))) {
    latest.set(
      kpiId,
      (await latestKpiReading(tx, input.workspaceId, kpiId))?.actualValue ??
        null,
    );
  }

  let keyResultsMoved = 0;
  for (const row of reading) {
    const value = latest.get(row.kpiId as string) ?? null;
    // Nothing recorded, or nothing new: an unmeasured KPI is not a zero, and a
    // history row for a value that did not change is a flat line drawn twice.
    if (value === null || value === asNumber(row.currentValue)) {
      continue;
    }
    await recordValueInTx(tx, {
      workspaceId: input.workspaceId,
      keyResultId: row.id,
      value,
      source: "kpi",
      authorMemberId: input.authorMemberId,
      note: "Recorded against the KPI",
    });
    keyResultsMoved += 1;
  }

  // Every goal, not only the ones whose value moved: a KPI's target or
  // direction can change its achievement without changing its reading.
  const thresholds = resolveRhythm(
    await readRhythmRow(tx, input.workspaceId),
  ).thresholds;
  const goalIds = [...new Set(reading.map((row) => row.goalId))];
  for (const goalId of goalIds) {
    await recomputeForGoal(tx, input.workspaceId, goalId, thresholds);
  }

  return { keyResultsMoved, goalsRecomputed: goalIds.length };
}
