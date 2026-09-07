import { describe, expect, it } from "vitest";
import {
  cycleScore,
  objectiveScore,
  portfolioVerdictOf,
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
