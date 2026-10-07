/**
 * §2.10's computed score for key results, read from the database (METHOD.md
 * §3.3, P9-T14a).
 *
 * The method computes it; this gathers what the method needs: each key
 * result's kind, its progress, whether a milestone was done, and for a
 * maintain key result its readings over the cycle, so the score is the share
 * of the cycle it spent inside its band rather than only where it stands
 * today. The quarterly review shows the number and the close keeps it beside
 * the one the room gave.
 */
import {
  activeOnly,
  cycles,
  goals,
  keyResults,
  keyResultValues,
  type WorkspaceTx,
} from "@openokr/db";
import { computedScore, shareInsideBand } from "@openokr/method";
import { and, asc, eq, inArray } from "drizzle-orm";

const dayStart = (on: string): number => new Date(`${on}T00:00:00Z`).getTime();

/**
 * Each key result's computed score at `at`, by id. A key result that is not
 * found is left out, so a caller reads a missing entry as "nothing computed".
 */
export async function computedScoresInTx(
  tx: WorkspaceTx,
  workspaceId: string,
  keyResultIds: readonly string[],
  at: Date,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (keyResultIds.length === 0) {
    return scores;
  }
  const rows = await tx
    .select({
      id: keyResults.id,
      kind: keyResults.kind,
      progressPct: keyResults.progressPct,
      doneAt: keyResults.doneAt,
      baselineValue: keyResults.baselineValue,
      targetValue: keyResults.targetValue,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .leftJoin(cycles, eq(cycles.id, goals.cycleId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        inArray(keyResults.id, [...keyResultIds]),
      ),
    );

  // A maintain key result's readings, oldest first, for its share inside.
  const maintained = rows.filter(
    (row) => row.kind === "maintain" && row.targetValue !== null,
  );
  const readings = new Map<string, { at: number; value: number }[]>();
  if (maintained.length > 0) {
    const values = await tx
      .select({
        keyResultId: keyResultValues.keyResultId,
        value: keyResultValues.value,
        createdAt: keyResultValues.createdAt,
      })
      .from(keyResultValues)
      .where(
        activeOnly(
          keyResultValues,
          and(
            eq(keyResultValues.workspaceId, workspaceId),
            inArray(
              keyResultValues.keyResultId,
              maintained.map((row) => row.id),
            ),
          ),
        ),
      )
      .orderBy(asc(keyResultValues.createdAt));
    for (const value of values) {
      const list = readings.get(value.keyResultId) ?? [];
      list.push({
        at: new Date(value.createdAt).getTime(),
        value: Number(value.value),
      });
      readings.set(value.keyResultId, list);
    }
  }

  for (const row of rows) {
    let insideShare: number | null = null;
    if (row.kind === "maintain" && row.targetValue !== null && row.startsOn) {
      const baseline = Number(row.baselineValue);
      const target = Number(row.targetValue);
      const until = Math.min(
        at.getTime(),
        row.endsOn ? dayStart(row.endsOn) + 86_400_000 : at.getTime(),
      );
      insideShare = shareInsideBand(
        readings.get(row.id) ?? [],
        { low: Math.min(baseline, target), high: Math.max(baseline, target) },
        dayStart(row.startsOn),
        until,
      );
    }
    scores.set(
      row.id,
      computedScore({
        kind: row.kind,
        progressPct: Number(row.progressPct),
        done: row.doneAt !== null,
        insideShare,
      }),
    );
  }
  return scores;
}
