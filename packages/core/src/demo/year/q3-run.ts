/**
 * Q3's weeks (P9-T22c-d, scenario chapter 3).
 *
 * The company objectives check in from week 1, the Monday after their step
 * published on 28 June; C6 from week 2, the Monday after its launch; the
 * teams' from week 3, the Monday after theirs on 14 July. Sales checks in
 * every two weeks from July (NW-Q3-02). Each key result moves from where Q2
 * left it towards where the grading on 13 September finds it (NW-Q3-14),
 * which is where Q4's table starts it; C6's first two key results read their
 * KPIs, so their monthly readings move them rather than a check-in. Product
 * checks in nothing in its two holiday weeks, Amara stands in for Sara, Leo
 * for Mei, and the Growth team's G1 joins from its second week.
 */
import { addDays } from "./calendar.ts";
import {
  type QuarterRun,
  type RunningKeyResult,
  type RunningObjective,
  weeklyCheckIns,
} from "./rhythm.ts";
import { need, type YearEvent } from "./timeline.ts";

/** Q3's Mondays, week 1 to week 11 (5 July to 13 September). */
const WEEKS = Array.from({ length: 11 }, (_unused, week) =>
  addDays("2027-07-05", week * 7),
);

/** The teams' set publishes on 14 July, so their first Monday is week 3. */
const TEAMS = 2;

/** Mei's leave starts on 2 August, week 5 (NW-Q3-08). */
const MEI_AWAY = 4;

/** Product's holiday weeks, of 9 and 16 August (NW-Q3-06). */
const PRODUCT_HOLIDAYS = [5, 6];

/** Sara's leave, 23 to 27 August, with Amara standing in. */
const SARA_AWAY = 7;

/** Daniel's at-risk check-in, 16 August (NW-Q3-10). */
const FORECAST = 6;

export const Q3_OBJECTIVES: readonly RunningObjective[] = [
  {
    key: "q3:C1",
    authorKey: "priya",
    keyResults: [
      {
        key: "q3:C1.1",
        direction: "reduce",
        baseline: 5.5,
        target: 4,
        finish: 4.4,
      },
      {
        key: "q3:C1.2",
        direction: "increase",
        baseline: 59,
        target: 64,
        finish: 63,
      },
    ],
  },
  {
    key: "q3:C2",
    authorKey: "tomas",
    committed: true,
    keyResults: [
      {
        key: "q3:C2.1",
        direction: "reduce",
        baseline: 109,
        target: 100,
        finish: 101,
        reason:
          "$101 against $100: the questionnaire surge in Q2 delayed the support tooling by six weeks.",
      },
      {
        key: "q3:C2.2",
        direction: "reduce",
        baseline: 2.32,
        target: 2.2,
        finish: 2.2,
      },
    ],
  },
  {
    key: "q3:C3",
    authorKey: "mei",
    committed: true,
    keyResults: [
      { key: "q3:C3.1", kind: "milestone", doneOn: "2027-09-10" },
      {
        key: "q3:C3.2",
        direction: "reduce",
        baseline: 4,
        target: 2,
        finish: 2,
      },
    ],
  },
  {
    key: "q3:C5",
    authorKey: "daniel",
    keyResults: [
      {
        key: "q3:C5.1",
        direction: "increase",
        baseline: 38,
        target: 45,
        // Flat into August, so the trend projects 41% (NW-Q3-10); the
        // battlecard refresh moves it after.
        path: [38.5, 39, 39.5, 40, 40, 40.2, 40.4, 41, 42, 42.5, 43],
        finish: 43,
      },
      // Brightline still takes one late-stage deal a month.
      {
        key: "q3:C5.2",
        direction: "reduce",
        baseline: 1,
        target: 0,
        finish: 1,
      },
    ],
  },
  {
    key: "q3:C6",
    authorKey: "hugo",
    committed: true,
    from: 1,
    keyResults: [
      {
        key: "q3:C6.1",
        direction: "increase",
        baseline: 7.6,
        target: 13.5,
        // August's reading, the latest at the grading (NW-Q3-14).
        finish: 10.1,
        readsKpi: true,
        reason:
          "August's 10.1% against 13.5%: the new price book reached renewals only on 1 September, and most renewals fall in Q4.",
      },
      {
        key: "q3:C6.2",
        direction: "increase",
        baseline: 125,
        target: 170,
        finish: 158,
        readsKpi: true,
        reason:
          "158 against 170: expansion was paused for most of Q2 and restarted in July.",
      },
      {
        key: "q3:C6.3",
        direction: "reduce",
        baseline: 14,
        target: 6,
        // Flat on the old price book, then moving from 1 September.
        path: [14, 14, 14, 13.5, 13, 12.5, 12, 11, 10, 8, 7],
        finish: 7,
        reason:
          "7% against 6%: three renewals were signed on the old price book in August.",
      },
    ],
  },
  {
    key: "q3:P4",
    authorKey: "sara",
    from: TEAMS,
    skip: PRODUCT_HOLIDAYS,
    keyResults: [
      {
        key: "q3:P4.1",
        direction: "increase",
        baseline: 40,
        target: 60,
        finish: 55,
      },
      // Manual calls stayed at 0.6 while the first session took the work.
      {
        key: "q3:P4.2",
        direction: "reduce",
        baseline: 0.6,
        target: 0.3,
        finish: 0.6,
      },
    ],
  },
  {
    key: "q3:P2",
    authorKey: "amara",
    from: TEAMS,
    skip: PRODUCT_HOLIDAYS,
    keyResults: [
      {
        key: "q3:P2.1",
        direction: "increase",
        baseline: 0,
        target: 13,
        finish: 13,
      },
    ],
  },
  {
    key: "q3:E1",
    authorKey: "mei",
    from: TEAMS,
    keyResults: [
      // Nothing shipped with Mei away and the questionnaires first.
      {
        key: "q3:E1.1",
        direction: "increase",
        baseline: 11,
        target: 20,
        finish: 11,
      },
    ],
  },
  {
    key: "q3:E2",
    authorKey: "leo",
    committed: true,
    from: TEAMS,
    keyResults: [
      {
        key: "q3:E2.1",
        kind: "maintain",
        direction: "maintain",
        baseline: 99.9,
        target: 100,
        finish: 99.95,
      },
      {
        key: "q3:E2.2",
        direction: "reduce",
        baseline: 45,
        target: 40,
        finish: 38,
      },
    ],
  },
  {
    key: "q3:S1",
    authorKey: "daniel",
    from: TEAMS,
    every: 2,
    keyResults: [
      {
        key: "q3:S1.1",
        direction: "increase",
        baseline: 79,
        target: 84,
        finish: 84,
      },
      {
        key: "q3:S1.2",
        direction: "reduce",
        baseline: 4.5,
        target: 4,
        finish: 4,
      },
    ],
  },
  {
    key: "q3:S3",
    authorKey: "jonas",
    from: TEAMS,
    every: 2,
    keyResults: [
      {
        key: "q3:S3.1",
        direction: "increase",
        baseline: 41,
        target: 50,
        finish: 46,
      },
    ],
  },
  {
    key: "q3:CS1",
    authorKey: "tomas",
    from: TEAMS,
    keyResults: [
      {
        key: "q3:CS1.1",
        direction: "increase",
        baseline: 80,
        target: 95,
        finish: 95,
      },
    ],
  },
  {
    key: "q3:SU1",
    authorKey: "kofi",
    from: TEAMS,
    keyResults: [
      {
        key: "q3:SU1.1",
        direction: "increase",
        baseline: 27,
        target: 33,
        finish: 31,
      },
    ],
  },
  {
    key: "q3:M1",
    authorKey: "nadia",
    from: TEAMS,
    keyResults: [
      {
        key: "q3:M1.1",
        direction: "increase",
        baseline: 20,
        target: 60,
        finish: 60,
      },
    ],
  },
  {
    key: "q3:F3",
    authorKey: "hugo",
    committed: true,
    from: TEAMS,
    keyResults: [
      { key: "q3:F3.1", kind: "milestone", doneOn: "2027-08-27" },
      { key: "q3:F3.2", kind: "milestone", doneOn: "2027-09-01" },
    ],
  },
  {
    // Started on 9 August (NW-Q3-09); its first check-in is the Monday after.
    key: "q3:G1",
    authorKey: "yuki",
    from: 6,
    keyResults: [
      { key: "q3:G1.1", kind: "baseline", doneOn: "2027-08-23", finish: 4.1 },
    ],
  },
];

/** G1.2, added on 23 August once G1.1 had found its number (NW-Q3-11). */
export const G1_2: RunningKeyResult & { readonly path: readonly number[] } = {
  key: "q3:G1.2",
  direction: "increase",
  baseline: 4.1,
  target: 7,
  // Weeks 9 to 11.
  path: [4.4, 4.8, 5.2],
  finish: 5.2,
};

function reported(
  objective: RunningObjective,
  week: number,
): {
  status: "on_track" | "caution" | "off_track";
  confidence: number;
} {
  if (objective.key === "q3:C5" && week >= FORECAST && week < FORECAST + 2) {
    // At risk, ahead of his reviewer asking (NW-Q3-10).
    return { status: "caution", confidence: 0.5 };
  }
  return objective.committed
    ? { status: "on_track", confidence: 0.8 }
    : { status: "on_track", confidence: 0.6 };
}

function said(objective: RunningObjective, monday: string): string {
  const lines: Record<string, string> = {
    "q3:C5:2027-08-16":
      "At risk: the forecast puts the win rate at 41% against 45%. This week's commitment is the battlecard refresh.",
    "q3:P4:2027-08-23":
      "Posted by Amara while Sara is away. Setup in the first session keeps climbing after the holiday weeks.",
    "q3:G1:2027-08-23":
      "The self-serve trial-to-paid rate is 4.1%. G1.1 is done, and G1.2 sets the target from it.",
    "q3:C3:2027-08-02":
      "Leo from here on, while Mei is away. The audit evidence is all in; the report is due by 15 September.",
  };
  return (
    lines[`${objective.key}:${monday}`] ??
    "Moving as planned this week. Nothing new in the way."
  );
}

const Q3_RUN: QuarterRun = {
  name: "Q3",
  weeks: WEEKS,
  firstWeek: 1,
  objectives: Q3_OBJECTIVES,
  reported,
  said,
  authorOf(objective, week) {
    // Leo covers C3 and E1 from Mei's first day away.
    if (
      (objective.key === "q3:C3" || objective.key === "q3:E1") &&
      week >= MEI_AWAY
    ) {
      return "leo";
    }
    // Amara stands in for Sara, and records G1's baseline.
    if (
      (objective.key === "q3:P4" || objective.key === "q3:G1") &&
      week === SARA_AWAY
    ) {
      return "amara";
    }
    return objective.authorKey;
  },
  extraValues(context, objective, week) {
    const value = G1_2.path[week - (WEEKS.length - G1_2.path.length)];
    return objective.key === "q3:G1" && value !== undefined
      ? [
          {
            keyResultId: need(context.ids.keyResults, G1_2.key, "Key result"),
            value,
            confidence: 0.6,
          },
        ]
      : [];
  },
};

/** Weeks 1 to 3, to the teams' first check-in (P9-T22c-d-a). */
export const Q3_EARLY_EVENTS: readonly YearEvent[] = WEEKS.slice(0, 3).map(
  (monday, week) => weeklyCheckIns(Q3_RUN, week, monday),
);

/** Weeks 4 to 11, the summer to the grading (P9-T22c-d-b). */
export const Q3_LATE_WEEKS: readonly YearEvent[] = WEEKS.slice(3).map(
  (monday, index) => weeklyCheckIns(Q3_RUN, 3 + index, monday),
);
