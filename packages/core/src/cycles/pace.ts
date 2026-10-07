/**
 * What a goal's progress signal is read against (METHOD.md §3.7, P9-T15a):
 * the workspace's choice of signal, and the progress expected today across
 * the goal's cycle. Read once per sweep or per review, not per goal.
 */
import { activeOnly, cycles, type WorkspaceTx } from "@openokr/db";
import {
  expectedProgressPct,
  type ProgressSignalPractice,
} from "@openokr/method";
import { and, eq } from "drizzle-orm";
import { practiceFromRow } from "../practice/settings.ts";
import { formatLocalDate, localDateIn } from "./generation.ts";
import { readRhythmRow, workspaceTimeZone } from "./service.ts";

export interface Pace {
  readonly practice: ProgressSignalPractice;
  /** Null with no cycle, which leaves the signal absolute. */
  readonly expectedPct: number | null;
}

export async function paceInTx(
  tx: WorkspaceTx,
  workspaceId: string,
  cycleId: string | null,
  now: Date = new Date(),
): Promise<Pace> {
  const { practice } = practiceFromRow(await readRhythmRow(tx, workspaceId));
  if (cycleId === null) {
    return { practice, expectedPct: null };
  }
  const [cycle] = await tx
    .select({ startsOn: cycles.startsOn, endsOn: cycles.endsOn })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        and(eq(cycles.workspaceId, workspaceId), eq(cycles.id, cycleId)),
      ),
    )
    .limit(1);
  if (!cycle) {
    return { practice, expectedPct: null };
  }
  const today = formatLocalDate(
    localDateIn(now, await workspaceTimeZone(tx, workspaceId)),
  );
  return {
    practice,
    expectedPct: expectedProgressPct(cycle.startsOn, cycle.endsOn, today),
  };
}
