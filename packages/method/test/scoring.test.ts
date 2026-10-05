import { describe, expect, it } from "vitest";
import {
  belowCommittedFloor,
  committedShareMet,
  computedScore,
  cycleScore,
  draftVerdict,
  expectedProgressPct,
  keyResultProgress,
  needsRootCause,
  objectiveScore,
  portfolioVerdictOf,
  progressSignal,
  SCORE_BAND_TEXT,
  scoreBand,
  scoreBandsIn,
  scoreNote,
  shareInsideBand,
  tooSafePattern,
  trendForecast,
} from "../src/scoring.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * Scoring beyond the bands (METHOD.md §3.2, §3.3, §3.4 and §8.6, P4-T10b-a).
 *
 * The bands themselves are covered by the threshold suite. What is here is the
 * two questions the document answers in different places and the package has to
 * keep apart: an objective's score is weighted, and a cycle's is not.
 */

const thresholds = canonThresholds();

describe("an objective's score (METHOD.md §3.2 and §3.3, P4-T10b-a)", () => {
  it("weights by the key result's own weight, not by count", () => {
    // The decision the document does not carry: a team that marked one key
    // result three times as important sees that in the score, exactly as it
    // sees it in the progress. A plain mean of these two is 0.5.
    expect(
      objectiveScore([
        { score: 0.2, weight: 3 },
        { score: 0.8, weight: 1 },
      ]),
    ).toBeCloseTo(0.35, 10);
  });

  it("matches the plain mean when every weight is equal", () => {
    // The weighting must not change the answer for the ordinary case, which is
    // every key result at weight one.
    expect(
      objectiveScore([
        { score: 0.4, weight: 1 },
        { score: 0.6, weight: 1 },
      ]),
    ).toBeCloseTo(0.5, 10);
  });

  it("leaves unscored key results out of the average entirely", () => {
    // Not counted as zero. A half-graded objective must not read as a failing
    // one while the room is still working through it.
    expect(
      objectiveScore([
        { score: 0.8, weight: 1 },
        { score: null, weight: 1 },
      ]),
    ).toBeCloseTo(0.8, 10);
  });

  it("has no score before anything is graded", () => {
    // Null rather than zero, so a screen can tell "not scored" from "scored
    // zero". They are different sentences to a room.
    expect(objectiveScore([])).toBeNull();
    expect(objectiveScore([{ score: null, weight: 1 }])).toBeNull();
  });

  it("has no score when every scored key result weighs nothing", () => {
    // A weight of zero contributes nothing and is not an error; a set that is
    // all zeros has no weighted answer, and null is the honest one rather than
    // a division by zero.
    expect(objectiveScore([{ score: 0.9, weight: 0 }])).toBeNull();
  });

  it("scores zero when the work scored zero", () => {
    // The case null must not be confused with.
    expect(objectiveScore([{ score: 0, weight: 1 }])).toBe(0);
  });
});

describe("the cycle score (METHOD.md §8.6, P4-T10b-a)", () => {
  it("is the plain average §8.6 asks for, not a weighted one", () => {
    // §8.6 words it exactly: the §3.4 portfolio average over every scored key
    // result in the cycle. Two different questions about two different sets,
    // and this one is not weighted.
    expect(cycleScore([0.2, 0.8])).toBeCloseTo(0.5, 10);
  });

  it("is null over an empty cycle", () => {
    expect(cycleScore([])).toBeNull();
  });

  it("feeds §3.4's verdict without recomputing the bands", () => {
    // The average and the verdict are separate: `portfolioVerdictOf` reads the
    // bands, so nothing here decides what a number means.
    const average = cycleScore([0.9, 0.95]) as number;
    expect(portfolioVerdictOf(average, thresholds)).toBe("too_safe");
    expect(
      portfolioVerdictOf(cycleScore([0.5, 0.5]) as number, thresholds),
    ).toBe("partial");
  });
});

describe("judging by kind (METHOD.md §2.8, §3.2, §3.3 and §3.4, P9-T11a)", () => {
  it("asks a committed key result short of 1.0 to explain the miss", () => {
    expect(scoreNote(0.9, "committed", thresholds)).toBe("explain_miss");
    expect(scoreNote(0.1, "committed", thresholds)).toBe("explain_miss");
    expect(scoreNote(1, "committed", thresholds)).toBe("none");
  });

  it("asks an aspirational key result with little progress for its root cause", () => {
    expect(scoreNote(0.2, "aspirational", thresholds)).toBe("root_cause");
    expect(scoreNote(0.6, "aspirational", thresholds)).toBe("none");
    // A stretch met in full is not called too safe on its own any more.
    expect(scoreNote(1, "aspirational", thresholds)).toBe("none");
  });

  it("calls a cycle too safe only when three quarters of its aspirational work hit 1.0", () => {
    const full = { score: 1, kind: "aspirational" } as const;
    const partial = { score: 0.6, kind: "aspirational" } as const;
    expect(tooSafePattern([full, full, full, partial], thresholds)).toBe(true);
    expect(tooSafePattern([full, full, partial, partial], thresholds)).toBe(
      false,
    );
  });

  it("leaves committed work out of the too-safe pattern", () => {
    const kept = { score: 1, kind: "committed" } as const;
    expect(tooSafePattern([kept, kept, kept], thresholds)).toBe(false);
    expect(
      tooSafePattern(
        [kept, kept, kept, { score: 0.6, kind: "aspirational" }],
        thresholds,
      ),
    ).toBe(false);
  });

  it("judges a committed set by the share met, not by an average", () => {
    expect(committedShareMet([1, 1, 0.9, 1], thresholds)).toBe(0.75);
    expect(committedShareMet([], thresholds)).toBeNull();
  });

  it("asks a root cause below each kind's own threshold", () => {
    expect(needsRootCause(0.5, "aspirational", thresholds)).toBe(true);
    expect(needsRootCause(0.6, "aspirational", thresholds)).toBe(false);
    expect(needsRootCause(0.9, "committed", thresholds)).toBe(true);
    expect(needsRootCause(1, "committed", thresholds)).toBe(false);
  });

  it("flags a committed key result below the confidence floor, never an aspirational one", () => {
    expect(belowCommittedFloor(0.6, "committed", thresholds)).toBe(true);
    expect(belowCommittedFloor(0.7, "committed", thresholds)).toBe(false);
    expect(belowCommittedFloor(0.1, "aspirational", thresholds)).toBe(false);
  });

  it("reads a drafting average into four bands", () => {
    expect(draftVerdict(0.95, thresholds)).toBe("near_certain");
    expect(draftVerdict(0.9, thresholds)).toBe("comfortable");
    expect(draftVerdict(0.7, thresholds)).toBe("sweet_spot");
    expect(draftVerdict(0.5, thresholds)).toBe("sweet_spot");
    expect(draftVerdict(0.3, thresholds)).toBe("sweet_spot");
    expect(draftVerdict(0.2, thresholds)).toBe("moonshot");
  });
});

describe("progress and score by the key result's kind (METHOD.md §2.10, P9-T12a)", () => {
  const numbers = {
    direction: "increase" as const,
    baseline: 0,
    target: 100,
    current: 40,
  };

  it("reads a milestone and a baseline as 0% until done and 100% after, whatever the numbers say", () => {
    for (const kind of ["milestone", "baseline"] as const) {
      expect(keyResultProgress({ ...numbers, kind }, thresholds)).toBe(0);
      expect(
        keyResultProgress({ ...numbers, kind, done: true }, thresholds),
      ).toBe(100);
    }
  });

  it("reads a maintain key result as its band, whatever its direction says", () => {
    expect(
      keyResultProgress(
        {
          kind: "maintain",
          direction: "increase",
          baseline: 99,
          target: 99.9,
          current: 99.5,
        },
        thresholds,
      ),
    ).toBe(100);
  });

  it("leaves a metric, and a key result with no kind, reading its direction", () => {
    expect(keyResultProgress({ ...numbers, kind: "metric" }, thresholds)).toBe(
      40,
    );
    expect(keyResultProgress(numbers, thresholds)).toBe(40);
  });

  it("scores a milestone and a baseline 1.0 when done and 0 when not", () => {
    expect(
      computedScore({ kind: "milestone", progressPct: 0, done: false }),
    ).toBe(0);
    expect(
      computedScore({ kind: "baseline", progressPct: 100, done: true }),
    ).toBe(1);
  });

  it("scores a metric from its progress, capped at 1.0", () => {
    expect(
      computedScore({ kind: "metric", progressPct: 70, done: false }),
    ).toBe(0.7);
    expect(
      computedScore({ kind: "metric", progressPct: 150, done: false }),
    ).toBe(1);
  });

  it("scores a maintain key result by its time inside the band, or where it stands without readings", () => {
    expect(
      computedScore({
        kind: "maintain",
        progressPct: 100,
        done: false,
        insideShare: 0.9,
      }),
    ).toBe(0.9);
    expect(
      computedScore({ kind: "maintain", progressPct: 100, done: false }),
    ).toBe(1);
  });

  it("measures the share of the window a value spent inside the band", () => {
    const band = { low: 99, high: 99.9 };
    // Inside for days 0 to 60, outside for 60 to 70, inside again to 90.
    const points = [
      { at: 0, value: 99.5 },
      { at: 60, value: 98.7 },
      { at: 70, value: 99.6 },
    ];
    expect(shareInsideBand(points, band, 0, 90)).toBeCloseTo(0.89, 2);
    // The reading in force before the window opens counts from its start.
    expect(shareInsideBand([{ at: -5, value: 99.5 }], band, 0, 90)).toBe(1);
    // Time before the first reading is not counted at all.
    expect(shareInsideBand([{ at: 45, value: 99.5 }], band, 0, 90)).toBe(1);
    expect(shareInsideBand([], band, 0, 90)).toBeNull();
    expect(shareInsideBand(points, band, 90, 90)).toBeNull();
  });
});

describe("§3.3's bands under each colouring (P9-T14a)", () => {
  const thresholds = canonThresholds();
  const google = { "scoring.colours": "google" } as const;
  const doerr = { "scoring.colours": "doerr" } as const;

  it("reads §11's 1.0, 0.6 and 0.3 under Google's colours, the default", () => {
    expect(scoreBandsIn(thresholds)).toEqual({
      achieved: 1,
      strong: 0.6,
      partial: 0.3,
    });
    expect(scoreBandsIn(thresholds, google)).toEqual(scoreBandsIn(thresholds));
    expect(scoreBand(0.65, thresholds, google)).toBe("strong");
  });

  it("reads Doerr's 0.7 and 0.4 where the workspace chose them", () => {
    expect(scoreBandsIn(thresholds, doerr)).toEqual({
      achieved: 1,
      strong: 0.7,
      partial: 0.4,
    });
    expect(scoreBand(0.65, thresholds, doerr)).toBe("partial");
    expect(scoreNote(0.35, "aspirational", thresholds, doerr)).toBe(
      "root_cause",
    );
    expect(scoreNote(0.35, "aspirational", thresholds, google)).toBe("none");
  });

  it("means one thing for a stretch and another for a promise", () => {
    expect(SCORE_BAND_TEXT.aspirational.strong).toBe(
      "On target. The expected range for a stretch",
    );
    expect(SCORE_BAND_TEXT.committed.fully_achieved).toBe("Met");
    for (const band of ["strong", "partial", "little"] as const) {
      expect(SCORE_BAND_TEXT.committed[band]).toBe("Missed. Explain the miss");
    }
  });
});

describe("§3.7's signal knows the date (P9-T15a)", () => {
  const thresholds = canonThresholds();
  const paceAware = { "progress.signal": "paceAware" } as const;
  const absolute = { "progress.signal": "absolute" } as const;
  // A thirteen-week quarter, 1 January to 1 April, read week by week.
  const week = (n: number) =>
    expectedProgressPct(
      "2027-01-01",
      "2027-04-01",
      (() => {
        const day = new Date(Date.UTC(2027, 0, 1 + 7 * n));
        return day.toISOString().slice(0, 10);
      })(),
    );

  it("acceptance: week 2 of 13 at 15% is green", () => {
    expect(
      progressSignal(15, thresholds, {
        practice: paceAware,
        expectedPct: week(2),
      }),
    ).toBe("green");
  });

  it("is amber more than 10 points behind the date, and red more than 25 behind", () => {
    const expected = week(8);
    expect(expected).toBeGreaterThan(60);
    const at = (progress: number) =>
      progressSignal(progress, thresholds, {
        practice: paceAware,
        expectedPct: expected,
      });
    expect(at(expected - 10)).toBe("green");
    expect(at(expected - 11)).toBe("amber");
    expect(at(expected - 25)).toBe("amber");
    expect(at(expected - 26)).toBe("red");
  });

  it("reads the absolute thresholds where the workspace chose them, or where no date is known", () => {
    expect(
      progressSignal(15, thresholds, {
        practice: absolute,
        expectedPct: week(2),
      }),
    ).toBe("red");
    expect(
      progressSignal(15, thresholds, {
        practice: paceAware,
        expectedPct: null,
      }),
    ).toBe("red");
    expect(progressSignal(80, thresholds)).toBe("green");
  });

  it("expects nothing before the cycle and everything from its last day", () => {
    expect(expectedProgressPct("2027-01-01", "2027-04-01", "2026-12-20")).toBe(
      0,
    );
    expect(expectedProgressPct("2027-01-01", "2027-04-01", "2027-04-01")).toBe(
      100,
    );
    expect(expectedProgressPct("2027-01-01", "2027-04-01", "2027-05-01")).toBe(
      100,
    );
  });
});

describe("§3.6's forecast waits for enough values (P9-T15a)", () => {
  const target = { direction: "increase" as const, baseline: 0, target: 100 };
  const points = [
    { at: 0, value: 10 },
    { at: 1, value: 20 },
    { at: 2, value: 30 },
    { at: 3, value: 40 },
  ];

  it("projects nothing from three values when four are asked for", () => {
    expect(trendForecast(points.slice(0, 3), 10, target, 4)).toBeNull();
  });

  it("projects from the fourth", () => {
    expect(trendForecast(points, 10, target, 4)?.projected).toBe(110);
  });
});
