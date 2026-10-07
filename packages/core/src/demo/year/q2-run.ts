/**
 * Q2's weeks (P9-T22c-c, scenario chapter 2, NW-Q2-08 to NW-Q2-19).
 *
 * The company objectives check in from week 1, the Monday after their step
 * published; the teams' from week 3, the Monday after theirs. Each key result
 * moves from where Q1 left it towards where the grading on 14 June finds it
 * (NW-Q2-19); a figure the chapter does not give is chosen so the quarter
 * grades to its 0.59 with eleven aspirational key results below 0.6. From
 * week 6 the competitor is in the numbers: Daniel's deals stall, the
 * pipeline drops, questionnaires pile up, and C5 starts.
 */
import { addDays } from "./calendar.ts";
import {
  monthlyReview,
  type QuarterRun,
  type RunningKeyResult,
  type RunningObjective,
  weeklyCheckIns,
} from "./rhythm.ts";
import { need, type YearEvent } from "./timeline.ts";

/** Q2's Mondays, week 1 to week 11 (5 April to 14 June). */
const WEEKS = Array.from({ length: 11 }, (_unused, week) =>
  addDays("2027-04-05", week * 7),
);

/** The teams' set publishes on 15 April, so their first Monday is week 3. */
const TEAMS = 2;

/** The week the competitor launches: week 6, Monday 10 May (NW-Q2-09). */
const BRIGHTLINE = 5;

export const Q2_OBJECTIVES: readonly RunningObjective[] = [
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
    // Started on 12 May (NW-Q2-10); its first check-in is the Monday after.
    key: "q2:C5",
    authorKey: "daniel",
    from: BRIGHTLINE + 1,
    keyResults: [
      { key: "q2:C5.1", kind: "baseline", doneOn: "2027-05-31", finish: 31 },
      {
        key: "q2:C5.2",
        direction: "reduce",
        baseline: 3,
        target: 0,
        path: [3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 1],
        finish: 1,
      },
      {
        key: "q2:C5.3",
        direction: "increase",
        baseline: 0,
        target: 80,
        path: [0, 0, 0, 0, 0, 0, 10, 18, 27, 36, 44],
        finish: 44,
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
        finish: 77,
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
        finish: 10,
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
        finish: 11,
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
        finish: 4.5,
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
        // Graded against the $2.9M it is eased to on 12 May (NW-Q2-11).
        target: 2.9,
        // Brightline takes $0.5M of late-stage pipeline in week 6 (NW-Q2-11).
        path: [2.6, 2.65, 2.75, 2.85, 2.95, 2.5, 2.55, 2.6, 2.62, 2.66, 2.7],
        finish: 2.7,
      },
      {
        key: "q2:S2.2",
        direction: "increase",
        baseline: 10,
        target: 12,
        finish: 11.2,
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
        finish: 80,
      },
      {
        key: "q2:CS1.2",
        direction: "increase",
        baseline: 96,
        target: 100,
        finish: 99,
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

/** C5.4, added on 31 May once C5.1 had found its number (NW-Q2-16). */
export const C5_4: RunningKeyResult & { readonly path: readonly number[] } = {
  key: "q2:C5.4",
  direction: "increase",
  baseline: 31,
  target: 45,
  // Weeks 10 and 11.
  path: [35, 38],
  finish: 38,
};

/** What changes from week 6, by objective and week. */
function reported(
  objective: RunningObjective,
  week: number,
): {
  status: "on_track" | "caution" | "off_track";
  confidence: number;
} {
  if (objective.key === "q2:S1" && week >= BRIGHTLINE) {
    // Three late-stage deals stall within the week (NW-Q2-09).
    return week === BRIGHTLINE
      ? { status: "off_track", confidence: 0.3 }
      : { status: "caution", confidence: week === BRIGHTLINE + 1 ? 0.4 : 0.5 };
  }
  if (objective.key === "q2:C3" && week > BRIGHTLINE) {
    // Questionnaires at twelve a week, then a sales engineer on them
    // (NW-Q2-14).
    return week === BRIGHTLINE + 1
      ? { status: "caution", confidence: 0.3 }
      : { status: "on_track", confidence: 0.6 };
  }
  if (objective.key === "q2:C2" && week >= BRIGHTLINE) {
    // Aspirational from 12 May, with two agents moved to the response.
    return { status: "caution", confidence: 0.6 };
  }
  return objective.committed
    ? { status: "on_track", confidence: 0.8 }
    : { status: "on_track", confidence: 0.6 };
}

/** What a check-in says, where the story has something to say. */
function said(objective: RunningObjective, monday: string): string {
  const lines: Record<string, string> = {
    "q2:S1:2027-05-10":
      "Brightline launched self-serve onboarding into the mid-market, 30% below our price. Three late-stage deals stalled this week. Confidence 3 in 10.",
    "q2:S1:2027-05-17":
      "The three deals are still stalled. Marketing and Sales are rebuilding the battlecard together, and C5 now carries the competitive response.",
    "q2:C2:2027-05-17":
      "Aspirational since 12 May: two support agents are on the competitive response until July.",
    "q2:S2:2027-05-17":
      "S2.1 eased to $2.9M on 12 May: Brightline's launch took $0.5M of late-stage pipeline. Ben's opportunities move to me before his last day.",
    "q2:C3:2027-05-17":
      "Prospects comparing vendors send twelve questionnaires a week, not five, and turnaround is at 7 days. Confidence 3 in 10.",
    "q2:C3:2027-05-24":
      "A sales engineer is on questionnaires for six weeks and the trust-centre page is up. Back to 6 in 10.",
    "q2:C5:2027-05-17":
      "Started on 12 May. Amara is establishing the win rate against Brightline, and the battlecard is in one opportunity in ten.",
    "q2:C5:2027-05-31":
      "The win rate against Brightline is 31%. C5.1 is done, and C5.4 sets the target from it.",
  };
  return (
    lines[`${objective.key}:${monday}`] ??
    "Moving as planned this week. Nothing new in the way."
  );
}

const Q2_RUN: QuarterRun = {
  name: "Q2",
  weeks: WEEKS,
  firstWeek: 1,
  objectives: Q2_OBJECTIVES,
  reported,
  said,
  confidenceOf: (objective, keyResult, week, reported) =>
    keyResult.key === "q2:S1.1" || keyResult.key === "q2:C3.2"
      ? reported.confidence
      : objective.key === "q2:C2" && week >= BRIGHTLINE
        ? 0.6
        : undefined,
  extraValues(context, objective, week) {
    const value = C5_4.path[week - (WEEKS.length - C5_4.path.length)];
    return objective.key === "q2:C5" && value !== undefined
      ? [
          {
            keyResultId: need(context.ids.keyResults, C5_4.key, "Key result"),
            value,
            confidence: 0.6,
          },
        ]
      : [];
  },
};

/** Weeks 1 to 5, up to the first monthly review (P9-T22c-c-a). */
export const Q2_EARLY_EVENTS: readonly YearEvent[] = [
  ...WEEKS.slice(0, BRIGHTLINE).map((monday, week) =>
    weeklyCheckIns(Q2_RUN, week, monday),
  ),
  monthlyReview("NW-Q2-08", "2027-05-03", "q2", {
    "q2:C1": "improving",
    "q2:C2": "flat",
    "q2:C3": "improving",
    "q2:C4": "flat",
  }),
];

/** Weeks 6 to 11, from the competitor's launch to the grading (P9-T22c-c-b). */
export const Q2_LATE_WEEKS: readonly YearEvent[] = WEEKS.slice(BRIGHTLINE).map(
  (monday, index) => weeklyCheckIns(Q2_RUN, BRIGHTLINE + index, monday),
);
