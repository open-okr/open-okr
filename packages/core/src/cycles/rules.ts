/**
 * The rules a cycle is read under (METHOD.md §12, P9-T14b).
 *
 * "A cycle keeps the rules it was graded under. When a cycle closes, the
 * practice settings and every threshold in force are recorded with it.
 * Changing a band or a cap later does not rewrite a closed cycle's
 * verdicts."
 *
 * | The cycle | Read under |
 * |---|---|
 * | Open | The workspace's settings now |
 * | Closed, with a snapshot | The snapshot taken at its close |
 * | Closed before snapshots existed | Today's canon, which no setting moves |
 *
 * A snapshot taken by an older release lacks any setting added since, and
 * takes the canon for it rather than leaving the reader a gap.
 */
import { activeOnly, cycles, type WorkspaceTx } from "@openokr/db";
import {
  canonThresholds,
  defaultPractice,
  type ResolvedPractice,
  type ResolvedThresholds,
} from "@openokr/method";
import { and, eq } from "drizzle-orm";
import { practiceFromRow } from "../practice/settings.ts";
import { resolveRhythm } from "./rhythm.ts";
import { readRhythmRow } from "./service.ts";

export interface CycleRules {
  readonly thresholds: ResolvedThresholds;
  readonly practice: ResolvedPractice;
  readonly source: "live" | "snapshot" | "canon";
}

/** What a close records: both, resolved, and when. */
export function rulesSnapshot(
  thresholds: ResolvedThresholds,
  practice: ResolvedPractice,
  at: Date,
): {
  readonly thresholds: Record<string, unknown>;
  readonly practice: Record<string, unknown>;
  readonly takenAt: string;
} {
  return {
    thresholds: { ...thresholds },
    practice: { ...practice },
    takenAt: at.toISOString(),
  };
}

/** The workspace's rules as they stand, for an open cycle or none. */
async function liveRulesInTx(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<CycleRules> {
  const row = await readRhythmRow(tx, workspaceId);
  return {
    thresholds: resolveRhythm(row).thresholds,
    practice: practiceFromRow(row).practice,
    source: "live",
  };
}

/** The rules `cycleId` is read under; the live ones for no cycle. */
export async function cycleRulesInTx(
  tx: WorkspaceTx,
  workspaceId: string,
  cycleId: string | null,
): Promise<CycleRules> {
  if (cycleId === null) {
    return liveRulesInTx(tx, workspaceId);
  }
  const [cycle] = await tx
    .select({
      status: cycles.status,
      snapshot: cycles.practiceSnapshot,
    })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        and(eq(cycles.workspaceId, workspaceId), eq(cycles.id, cycleId)),
      ),
    )
    .limit(1);
  if (!cycle || cycle.status !== "closed") {
    return liveRulesInTx(tx, workspaceId);
  }
  if (!cycle.snapshot) {
    return {
      thresholds: canonThresholds(),
      practice: defaultPractice(),
      source: "canon",
    };
  }
  return {
    thresholds: {
      ...canonThresholds(),
      ...cycle.snapshot.thresholds,
    } as ResolvedThresholds,
    practice: {
      ...defaultPractice(),
      ...cycle.snapshot.practice,
    } as ResolvedPractice,
    source: "snapshot",
  };
}
