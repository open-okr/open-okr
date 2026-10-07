/**
 * Q2's weeks (P9-T22c-c-a, scenario chapter 2, NW-Q2-08).
 *
 * The company objectives check in from week 1, the Monday after their step
 * published; the teams' from week 3, the Monday after theirs. Each key result
 * moves from where Q1 left it towards where the grading on 14 June finds it
 * (NW-Q2-19); a figure the chapter does not give is chosen so the quarter
 * grades to its 0.59 with eleven aspirational key results below 0.6.
 */
import { addDays } from "./calendar.ts";
import {
  monthlyReview,
  type QuarterRun,
  type RunningObjective,
  weeklyCheckIns,
} from "./rhythm.ts";
import type { YearEvent } from "./timeline.ts";

/** Q2's Mondays, week 1 to week 11 (5 April to 14 June). */
const WEEKS = Array.from({ length: 11 }, (_unused, week) =>
  addDays("2027-04-05", week * 7),
);

/** The teams' set publishes on 15 April, so their first Monday is week 3. */
const TEAMS = 2;

const Q2_OBJECTIVES: readonly RunningObjective[] = [
  {
    key: "q2:C1",
    authorKey: "priya",
    keyResults: [
      {
        key: "q2:C1.1",
        direction: "reduce",
        baseline: 7,
        target: 5,
        finish: 5.5,
      },
      {
        key: "q2:C1.2",
        direction: "increase",
        baseline: 56,
        target: 62,
        finish: 59,
      },
    ],
  },
  {
    key: "q2:C2",
    authorKey: "tomas",
    committed: true,
    keyResults: [
      {
        key: "q2:C2.1",
        direction: "reduce",
        baseline: 2.55,
        target: 2.3,
        finish: 2.32,
      },
      {
        key: "q2:C2.2",
        direction: "reduce",
        baseline: 118,
        target: 108,
        finish: 113,
      },
    ],
  },
  {
    key: "q2:C3",
    authorKey: "mei",
    committed: true,
    keyResults: [
      {
        key: "q2:C3.1",
        kind: "maintain",
        direction: "maintain",
        baseline: 0,
        target: 0,
        finish: 0,
      },
      {
        key: "q2:C3.2",
        direction: "reduce",
        baseline: 10,
        target: 4,
        // Twelve questionnaires a week instead of five from May; 7 days on
        // 17 May (NW-Q2-14), and back on course with a sales engineer on it.
        path: [9.6, 9.2, 8.8, 8.4, 8, 7.6, 7, 6, 5, 4.5, 4],
        finish: 4,
      },
    ],
  },
  {
    key: "q2:C4",
    authorKey: "elena",
    // Stopped on 12 May (NW-Q2-10): its last check-in is week 6's.
    until: 5,
    keyResults: [
      {
        key: "q2:C4.1",
        direction: "increase",
        baseline: 138,
        target: 170,
        finish: 152,
      },
      {
        key: "q2:C4.2",
        direction: "increase",
        baseline: 100,
        target: 103,
        finish: 101,
      },
    ],
  },
  {
    key: "q2:P1",
    authorKey: "sara",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:P1.1",
        direction: "increase",
        baseline: 72,
        target: 80,
        finish: 76,
      },
      {
        key: "q2:P1.2",
        direction: "reduce",
        baseline: 0.8,
        target: 0.5,
        finish: 0.6,
      },
    ],
  },
  {
    key: "q2:P2",
    authorKey: "amara",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:P2.1",
        direction: "increase",
        baseline: 0,
        target: 13,
        finish: 11,
      },
    ],
  },
  {
    key: "q2:E1",
    authorKey: "mei",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:E1.1",
        direction: "increase",
        baseline: 10,
        target: 12,
        finish: 11.5,
      },
      {
        key: "q2:E1.2",
        direction: "reduce",
        baseline: 450,
        target: 380,
        finish: 405,
      },
    ],
  },
  {
    key: "q2:E2",
    authorKey: "leo",
    committed: true,
    from: TEAMS,
    keyResults: [
      {
        key: "q2:E2.1",
        kind: "maintain",
        direction: "maintain",
        baseline: 99.9,
        target: 100,
        finish: 99.95,
      },
      {
        key: "q2:E2.2",
        direction: "reduce",
        baseline: 50,
        target: 45,
        finish: 45,
      },
    ],
  },
  {
    key: "q2:S1",
    authorKey: "daniel",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:S1.1",
        direction: "increase",
        baseline: 76,
        target: 82,
        finish: 79,
      },
      {
        key: "q2:S1.2",
        direction: "reduce",
        baseline: 5,
        target: 4,
        finish: 4.4,
      },
    ],
  },
  {
    key: "q2:S2",
    authorKey: "jonas",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:S2.1",
        direction: "increase",
        baseline: 2.6,
        target: 3.4,
        // Brightline takes $0.5M of late-stage pipeline in week 6 (NW-Q2-11).
        path: [2.6, 2.65, 2.75, 2.85, 2.95, 2.5, 2.55, 2.6, 2.62, 2.66, 2.7],
        finish: 2.7,
      },
      {
        key: "q2:S2.2",
        direction: "increase",
        baseline: 10,
        target: 12,
        finish: 11,
      },
    ],
  },
  {
    key: "q2:CS1",
    authorKey: "tomas",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:CS1.1",
        direction: "increase",
        baseline: 74,
        target: 90,
        finish: 84,
      },
      {
        key: "q2:CS1.2",
        direction: "increase",
        baseline: 96,
        target: 100,
        finish: 98.5,
      },
    ],
  },
  {
    key: "q2:CS2",
    authorKey: "tomas",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:CS2.1",
        direction: "increase",
        baseline: 0.4,
        target: 0.8,
        finish: 0.5,
      },
    ],
  },
  {
    key: "q2:SU1",
    authorKey: "kofi",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:SU1.1",
        direction: "increase",
        baseline: 22,
        target: 30,
        finish: 27,
      },
    ],
  },
  {
    key: "q2:M1",
    authorKey: "nadia",
    from: TEAMS,
    keyResults: [
      {
        key: "q2:M1.1",
        direction: "increase",
        baseline: 18,
        target: 25,
        finish: 21,
      },
    ],
  },
  {
    key: "q2:F2",
    authorKey: "hugo",
    committed: true,
    from: TEAMS,
    keyResults: [
      {
        key: "q2:F2.1",
        direction: "increase",
        baseline: 0,
        target: 12,
        finish: 12,
      },
    ],
  },
];

const Q2_RUN: QuarterRun = {
  name: "Q2",
  weeks: WEEKS,
  firstWeek: 1,
  objectives: Q2_OBJECTIVES,
  reported: (objective) =>
    objective.committed
      ? { status: "on_track", confidence: 0.8 }
      : { status: "on_track", confidence: 0.6 },
  said: () => "Moving as planned this week. Nothing new in the way.",
};

/** Weeks 1 to 5, up to the first monthly review (P9-T22c-c-a). */
export const Q2_EARLY_EVENTS: readonly YearEvent[] = [
  ...WEEKS.slice(0, 5).map((monday, week) =>
    weeklyCheckIns(Q2_RUN, week, monday),
  ),
  monthlyReview("NW-Q2-08", "2027-05-03", "q2", {
    "q2:C1": "improving",
    "q2:C2": "flat",
    "q2:C3": "improving",
    "q2:C4": "flat",
  }),
];
