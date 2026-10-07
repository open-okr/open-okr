/**
 * Q4's weeks (P9-T22c-e, scenario chapter 4).
 *
 * The company objectives check in from week 1, the Monday after their step
 * published on 27 September; the teams' from week 3, the Monday after theirs
 * on 14 October, Sales every two weeks. Each key result moves from where Q3
 * left it towards where the grading on 13 December finds it (NW-Q4-09) and
 * the annual review reads it (NW-Q4-06). The margin, expansion, retention
 * and deflection key results read their KPIs. Mei checks in on E1 from her
 * return on 25 October, and Leo checks in on E2 at 3 in 10 after the
 * outage of 3 December.
 */
import { addDays } from "./calendar.ts";
import {
  type QuarterRun,
  type RunningObjective,
  weeklyCheckIns,
} from "./rhythm.ts";
import type { YearEvent } from "./timeline.ts";

/** Q4's Mondays, week 1 to week 11 (4 October to 13 December). */
const WEEKS = Array.from({ length: 11 }, (_unused, week) =>
  addDays("2027-10-04", week * 7),
);

/** The teams' set publishes on 14 October, so their first Monday is week 3. */
const TEAMS = 2;

/** Mei is back on 25 October, week 4 (NW-Q4-02). */
const MEI_BACK = 3;

/** The outage of 3 December, reported on week 10's Monday (NW-Q4-04). */
const OUTAGE = 9;

export const Q4_OBJECTIVES: readonly RunningObjective[] = [
  {
    key: "q4:C1",
    authorKey: "priya",
    keyResults: [
      {
        key: "q4:C1.1",
        direction: "reduce",
        baseline: 4.4,
        target: 3.5,
        finish: 3.8,
      },
      {
        key: "q4:C1.2",
        direction: "increase",
        baseline: 63,
        target: 68,
        finish: 66,
      },
    ],
  },
  {
    key: "q4:C5",
    authorKey: "daniel",
    keyResults: [
      {
        key: "q4:C5.1",
        direction: "increase",
        baseline: 43,
        target: 50,
        finish: 47,
      },
    ],
  },
  {
    key: "q4:C6",
    authorKey: "hugo",
    committed: true,
    keyResults: [
      {
        key: "q4:C6.1",
        direction: "increase",
        baseline: 10.4,
        target: 13.5,
        // November's 13.6%, recorded on 6 December (NW-Q4-05).
        finish: 13.6,
        readsKpi: true,
      },
      {
        key: "q4:C6.2",
        direction: "reduce",
        baseline: 7,
        target: 6,
        finish: 6,
      },
    ],
  },
  {
    key: "q4:C7",
    authorKey: "tomas",
    committed: true,
    keyResults: [
      {
        key: "q4:C7.1",
        direction: "increase",
        baseline: 95,
        target: 100,
        finish: 100,
      },
      {
        key: "q4:C7.2",
        kind: "maintain",
        direction: "maintain",
        baseline: 92,
        target: 100,
        finish: 93,
      },
    ],
  },
  {
    key: "q4:C8",
    authorKey: "tomas",
    keyResults: [
      {
        key: "q4:C8.1",
        direction: "increase",
        baseline: 158,
        target: 200,
        finish: 185,
        readsKpi: true,
      },
      {
        key: "q4:C8.2",
        direction: "increase",
        baseline: 101,
        target: 104,
        finish: 104,
        readsKpi: true,
      },
    ],
  },
  {
    key: "q4:P4",
    authorKey: "sara",
    from: TEAMS,
    keyResults: [
      {
        key: "q4:P4.1",
        direction: "increase",
        baseline: 55,
        target: 65,
        finish: 63,
      },
    ],
  },
  {
    key: "q4:G1",
    authorKey: "yuki",
    from: TEAMS,
    keyResults: [
      {
        key: "q4:G1.2",
        direction: "increase",
        baseline: 5.2,
        target: 7,
        finish: 6.2,
      },
    ],
  },
  {
    key: "q4:E1",
    authorKey: "mei",
    from: TEAMS,
    keyResults: [
      {
        key: "q4:E1.1",
        direction: "increase",
        baseline: 2,
        target: 8,
        finish: 8,
      },
    ],
  },
  {
    key: "q4:E2",
    authorKey: "leo",
    committed: true,
    from: TEAMS,
    keyResults: [
      {
        key: "q4:E2.1",
        kind: "maintain",
        direction: "maintain",
        baseline: 99.9,
        target: 100,
        // In band until the outage, then December's 99.4%.
        path: [
          99.95, 99.95, 99.95, 99.96, 99.95, 99.94, 99.95, 99.95, 99.95, 99.4,
          99.4,
        ],
        finish: 99.4,
      },
      {
        key: "q4:E2.2",
        direction: "reduce",
        baseline: 38,
        target: 35,
        finish: 34,
      },
    ],
  },
  {
    key: "q4:CS3",
    authorKey: "tomas",
    committed: true,
    from: TEAMS,
    keyResults: [
      {
        key: "q4:CS3.1",
        direction: "reduce",
        baseline: 101,
        target: 95,
        finish: 97,
      },
      {
        key: "q4:CS3.2",
        direction: "increase",
        baseline: 31,
        target: 35,
        finish: 35,
        readsKpi: true,
      },
    ],
  },
  {
    key: "q4:S3",
    authorKey: "jonas",
    from: TEAMS,
    every: 2,
    keyResults: [
      {
        key: "q4:S3.1",
        direction: "increase",
        baseline: 46,
        target: 55,
        finish: 51,
      },
    ],
  },
  {
    key: "q4:F4",
    authorKey: "hugo",
    committed: true,
    from: TEAMS,
    keyResults: [{ key: "q4:F4.1", kind: "milestone", doneOn: "2027-12-09" }],
  },
];

function reported(
  objective: RunningObjective,
  week: number,
): {
  status: "on_track" | "caution" | "off_track";
  confidence: number;
} {
  if (objective.key === "q4:E2" && week >= OUTAGE) {
    // Honest about December (NW-Q4-04).
    return { status: "off_track", confidence: 0.3 };
  }
  return objective.committed
    ? { status: "on_track", confidence: 0.8 }
    : { status: "on_track", confidence: 0.6 };
}

function said(objective: RunningObjective, monday: string): string {
  const lines: Record<string, string> = {
    "q4:E2:2027-12-06":
      "A database failover failed on Friday and we were down for four hours. December's uptime reads 99.4%. The failover runbook and a tested replica are due on 17 December. Confidence 3 in 10.",
    "q4:E1:2027-10-25":
      "Mei back from today, and E1 with her. Two of the eight renewal and billing answers are in.",
    "q4:C6:2027-12-06":
      "November's margin is 13.6%, inside the healthy band for the first time since 2026. One month is not a trend; we decide at the retrospective.",
  };
  return (
    lines[`${objective.key}:${monday}`] ??
    "Moving as planned this week. Nothing new in the way."
  );
}

const Q4_RUN: QuarterRun = {
  name: "Q4",
  weeks: WEEKS,
  firstWeek: 1,
  objectives: Q4_OBJECTIVES,
  reported,
  said,
  confidenceOf: (_objective, keyResult, week, reported) =>
    keyResult.key === "q4:E2.1" && week >= OUTAGE
      ? reported.confidence
      : undefined,
  // Leo holds E1 until Mei is back.
  authorOf: (objective, week) =>
    objective.key === "q4:E1" && week < MEI_BACK ? "leo" : objective.authorKey,
};

/** Weeks 1 to 10, to the outage and November's margin (P9-T22c-e-a). */
export const Q4_EARLY_EVENTS: readonly YearEvent[] = WEEKS.slice(0, 10).map(
  (monday, week) => weeklyCheckIns(Q4_RUN, week, monday),
);

/** Week 11, the Monday of the grading (P9-T22c-e-b). */
export const Q4_LATE_WEEKS: readonly YearEvent[] = WEEKS.slice(10).map(
  (monday, index) => weeklyCheckIns(Q4_RUN, 10 + index, monday),
);
