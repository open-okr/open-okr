import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { PHASE_TITLES, phaseWorkAllowed } from "@openokr/method";
import { getPool } from "./auth";

/**
 * What the strip under the topbar says (UIUX-PLAN.md §3: "When a cycle is in
 * planning, a slim persistent strip sits under the topbar: the phase name, what
 * is blocking it, and the days until the publication deadline. It disappears
 * once the cycle is published and running").
 *
 * Three conditions have to hold before it appears at all: a cycle exists, it is
 * still in planning, and there is a deadline to count to. The strip is a
 * countdown, and a countdown with no target is decoration.
 *
 * A failure here returns null rather than throwing. The strip is chrome on every
 * authenticated page, and a workspace whose cycle read fails should still be able
 * to reach its settings and fix it.
 */
export interface CycleStripData {
  readonly phaseLabel: string;
  readonly blocking: string | null;
  readonly dueInDays: number;
}

export async function loadCycleStrip(
  workspaceId: string,
  userId: string,
  level: number,
): Promise<CycleStripData | null> {
  if (level < ACCESS_LEVELS.view) {
    return null;
  }

  const context = {
    pool: getPool(),
    workspaceId,
    actor: { kind: "human" as const, userId },
  };

  try {
    const cycle = await callAction(context, "cycles.current", {
      mode: "quarterly",
    });
    if (cycle?.status !== "planning") {
      return null;
    }

    const workflow = await callAction(context, "workflow.read", {
      cycleId: cycle.id,
    });
    if (workflow.daysToDeadline === null) {
      return null;
    }

    // What is blocking the phase the facilitator is on, in one line. The panel
    // on the cycle page lists every reason; the strip has room for the first and
    // a count of the rest.
    const work = phaseWorkAllowed(workflow.phase, workflow.phases);
    const own = workflow.phases[workflow.phase];
    const reasons = work.allowed ? (own?.missing ?? []) : work.because;
    const blocking =
      reasons.length === 0
        ? null
        : reasons.length === 1
          ? reasons[0]
          : `${reasons[0]} (and ${reasons.length - 1} more)`;

    return {
      phaseLabel: `Phase ${workflow.phase} · ${PHASE_TITLES[workflow.phase]}`,
      blocking: blocking ?? null,
      dueInDays: workflow.daysToDeadline,
    };
  } catch (error) {
    if (error instanceof OperationError) {
      return null;
    }
    throw error;
  }
}
