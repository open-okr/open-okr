import { describe, expect, it } from "vitest";
import {
  belowCommittedFloor,
  committedShareMet,
  cycleScore,
  draftVerdict,
  needsRootCause,
  objectiveScore,
  portfolioVerdictOf,
  scoreNote,
  tooSafePattern,
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
