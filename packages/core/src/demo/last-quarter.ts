/**
 * The quarter Northwind Labs already finished (P8-T13b).
 *
 * **The demo has never held one, and the gap was recorded rather than hidden.**
 * P3-T17 wrote "the scorecard stays empty. It reads `key_results.score`, and
 * scoring at the quarterly review is P4-T10. There is nothing to seed yet."
 * P4-T10 shipped. So the scorecard, the closing diagnostic and the whole
 * argument the product is built on, that a missed quarter is either a strategy
 * problem or a cadence one and the room can tell which, were all invisible in
 * the demo of a product whose differentiator is exactly that.
 *
 * This chapter runs a whole review of the previous quarter, through the same
 * actions a room uses: a cycle, two objectives, five key results, a quarterly
 * session opened, each key result graded with its reason, the scores revealed,
 * the §8.5 survey answered, §8.6's diagnostic recorded, the session closed
 * (which is what turns grades into facts on the key results) and the cycle
 * snapshotted (which is what puts a row on the scorecard).
 *
 * **The verdict is built, not invented.** The scores below average 0.58,
 * under §8.6's cycle floor of 0.7, and the two rhythm statements are answered
 * 4 and 4, over its rhythm floor of 3.5. That combination is "strategy or
 * OKR-quality problem": the team ran the rhythm and still missed, so the
 * prescription is to fix the key results rather than push the team. Nothing
 * here writes that verdict. `packages/method` derives it from the two numbers,
 * and if somebody changes either threshold the demo changes with it, which is
 * the point.
 *
 * **One respondent, and the screen says so.** The survey is anonymous per
 * member and every write in the seed is authored by whoever ran it, so the
 * rhythm score is one person's reading rather than a room's. A seed that
 * submitted five invented responses would be putting words in the mouths of
 * people who do not have accounts.
 */

/** One graded key result from the quarter that is over. */
interface LastQuarterKeyResult {
  readonly title: string;
  readonly unit?: string;
  readonly direction: "increase" | "reduce";
  readonly indicatorType: "lagging" | "leading";
  readonly baselineValue: number;
  readonly targetValue: number;
  /** Where it actually finished. */
  readonly finalValue: number;
  /** §8.3's grade, 0.0 to 1.0. */
  readonly score: number;
  /** §8.3's one-line reason. Facts, not feelings. */
  readonly reason: string;
}

export interface LastQuarterObjective {
  readonly title: string;
  readonly description: string;
  readonly championKey: "priya" | "daniel";
  readonly keyResults: readonly LastQuarterKeyResult[];
}

/**
 * Two objectives, five key results, averaging 0.58.
 *
 * Deliberately not a disaster and not a success. A quarter at 0.2 tells the
 * room nothing it did not already know, and one at 0.9 has no diagnostic worth
 * reading. 0.58 with a healthy rhythm is the case the product exists to name.
 */
export const LAST_QUARTER: readonly LastQuarterObjective[] = [
  {
    title: "Make the first thirty days prove the product",
    description:
      "The bet was that activation is what retention is made of, and that shortening time to first value is the lever that moves it. Two of the three measures moved. Retention did not.",
    championKey: "priya",
    keyResults: [
      {
        title: "Raise 30-day retention from 58% to 72%",
        unit: "%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 58,
        targetValue: 72,
        finalValue: 63,
        score: 0.4,
        reason:
          "Retention moved five points of the fourteen. Activation rose and did not carry it.",
      },
      {
        title: "Raise week-one activation from 41% to 60%",
        unit: "%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 41,
        targetValue: 60,
        finalValue: 57,
        score: 0.8,
        reason:
          "Sixteen points of the nineteen, and the last three stalled on the import step.",
      },
      {
        title: "Cut time to first value from 9 days to 3 days",
        unit: "days",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 9,
        targetValue: 3,
        finalValue: 5,
        score: 0.7,
        reason:
          "Down to five days. The remaining two are the manual data import, which was out of scope.",
      },
    ],
  },
  {
    title: "Win mid-market accounts we can keep",
    description:
      "Pipeline was never the problem. The bet was that qualifying harder at the top would raise what survives to renewal.",
    championKey: "daniel",
    keyResults: [
      {
        title: "Raise mid-market win rate from 22% to 32%",
        unit: "%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 22,
        targetValue: 32,
        finalValue: 26,
        score: 0.4,
        reason:
          "Four points of the ten. Two of the three losses in March were on the same missing integration.",
      },
      {
        title: "Cut median sales cycle from 64 days to 45 days",
        unit: "days",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 64,
        targetValue: 45,
        finalValue: 55,
        score: 0.5,
        reason:
          "Nine days of the nineteen, all of it from the new discovery call.",
      },
    ],
  },
];

/**
 * The §8.5 survey, answered.
 *
 * Statements two and five are the two §8.6 reads (`RHYTHM_STATEMENTS`), and
 * both are answered 4: the weekly rhythm held. The other three are lower,
 * which is what makes the retrospective's "lowest statement becomes next
 * cycle's process OKR" rule have something to point at.
 */
export const LAST_QUARTER_PROCESS_HEALTH: readonly {
  statementKey: number;
  score: number;
}[] = [
  { statementKey: 1, score: 3 },
  { statementKey: 2, score: 4 },
  { statementKey: 3, score: 2 },
  { statementKey: 4, score: 3 },
  { statementKey: 5, score: 4 },
];

/** The review's own title, as it appears in the session list. */
export const LAST_QUARTER_REVIEW_TITLE = "Quarterly review";
