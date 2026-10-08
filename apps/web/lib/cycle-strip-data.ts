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
  /** The deadline in words, already in the reader's language. */
  readonly due: string;
}

/** The translate function the shell already holds. */
type Translate = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

function dueText(t: Translate, days: number): string {
  if (days === 0) {
    return t("shell.cycleStrip.dueToday");
  }
  if (days > 0) {
    return days === 1
      ? t("shell.cycleStrip.toPublishOne", { count: days })
      : t("shell.cycleStrip.toPublishOther", { count: days });
  }
  const late = Math.abs(days);
  return late === 1
    ? t("shell.cycleStrip.overdueOne", { count: late })
    : t("shell.cycleStrip.overdueOther", { count: late });
}

export async function loadCycleStrip(
  workspaceId: string,
  userId: string,
  level: number,
  t: Translate,
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
    // "Hidden" phases mean OKRs are written and tracked without the planning
    // workflow, so the strip that walks it is not shown (METHOD.md §2.3).
    if (workflow.practice.phaseEnforcement === "hidden") {
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
          : t("shell.cycleStrip.andMore", {
              first: reasons[0] ?? "",
              count: reasons.length - 1,
            });

    return {
      phaseLabel: t("common.phase3", {
        phase: workflow.phase,
        phaseTitle: PHASE_TITLES[workflow.phase] ?? "",
      }),
      blocking: blocking ?? null,
      dueInDays: workflow.daysToDeadline,
      due: dueText(t, workflow.daysToDeadline),
    };
  } catch (error) {
    if (error instanceof OperationError) {
      return null;
    }
    throw error;
  }
}
