/**
 * The OKR levels a cycle uses (P9-T07a-c, METHOD v2 §2.7).
 *
 * "A workspace chooses the levels it uses. A change applies to cycles that
 * start after it: a running or closed cycle keeps the levels it began with,
 * so no objective is ever left at a level that no longer exists."
 *
 * **`cycles.levels` is the record**, and has been since P3-T01; nothing wrote
 * anything to it but its default and `cycles.update`. A cycle now gets the
 * practice's levels when it is created, and a change to the practice reaches
 * the cycles that have not started. A cycle that has started keeps its own.
 *
 * **What a cycle offers is its record plus any level an objective in it
 * already has**, so an objective written before a level was turned off is
 * never shown at a level the screen will not draw.
 */
import { activeOnly, cycles, goals, type WorkspaceTx } from "@openokr/db";
import { levelsInUse, OKR_LEVELS, type OkrLevel } from "@openokr/method";
import { eq, gt } from "drizzle-orm";
import { readRhythmRow } from "../cycles/service.ts";
import { practiceFromRow } from "./settings.ts";

/** The levels the workspace's practice uses today. */
async function practiceLevelsInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: WorkspaceTx<TSchema>, workspaceId: string): Promise<OkrLevel[]> {
  return levelsInUse(
    practiceFromRow(await readRhythmRow(tx, workspaceId)).practice,
  );
}

const isLevel = (value: unknown): value is OkrLevel =>
  typeof value === "string" &&
  (OKR_LEVELS as readonly string[]).includes(value);

/**
 * The levels one cycle offers: its own record, plus every level its live
 * objectives already use, in §2.7's order. A cycle that cannot be found reads
 * as the practice's levels, so a caller asking about one it is about to
 * refuse still gets an answer.
 */
export async function cycleLevelsInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  workspaceId: string,
  cycleId: string,
): Promise<OkrLevel[]> {
  const [cycle] = await tx
    .select({ levels: cycles.levels })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, cycleId),
      ),
    )
    .limit(1);
  const recorded = Array.isArray(cycle?.levels)
    ? cycle.levels.filter(isLevel)
    : await practiceLevelsInTx(tx, workspaceId);
  const used = await tx
    .selectDistinct({ level: goals.level })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
      ),
    );
  const offered = new Set<string>([
    ...recorded,
    ...used.map((row) => row.level),
  ]);
  return OKR_LEVELS.filter((level) => offered.has(level));
}

/**
 * Hands a changed set of levels to every cycle that has not started.
 *
 * `today` is the workspace's own local date, as every rhythm date is. A cycle
 * starting today has started.
 */
export async function carryLevelsToUnstartedCyclesInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  workspaceId: string,
  levels: readonly OkrLevel[],
  today: string,
): Promise<number> {
  // openokr:allow-mutation: called from inside the practice operation, so
  // the change and its audit row commit together.
  const changed = await tx
    .update(cycles)
    .set({ levels: [...levels], updatedAt: new Date() })
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        gt(cycles.startsOn, today),
      ),
    )
    .returning({ id: cycles.id });
  return changed.length;
}
