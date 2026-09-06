import { describe, expect, it } from "vitest";
import { linkedWorkDivergence, linkedWorkShare } from "../src/linked-work.ts";

/**
 * Linked work, and the one thing it must never become (TECHNICAL-PLAN §4.9,
 * P5-T11).
 *
 * The whole file is about a single sentence in §4.9: the ratio of completed
 * linked tasks "never silently replaces the measured value". So the first test
 * is that nothing here returns a progress figure for a key result, and every
 * other test is about when the two disagree loudly enough to be worth saying.
 */

describe("the share, which is a share of the work and not of the measure", () => {
  it("is null when there is no linked work at all", () => {
    // Null rather than zero, and the difference shows on a screen: a key result
    // nobody has planned work for is not the same as one with ten tasks open.
    expect(linkedWorkShare({ done: 0, total: 0 })).toBeNull();
  });

  it("counts finished work over planned work", () => {
    expect(linkedWorkShare({ done: 1, total: 4 })).toBe(0.25);
    expect(linkedWorkShare({ done: 4, total: 4 })).toBe(1);
  });
});

describe("the divergence §4.9 names", () => {
  const base = {
    keyResultTitle: "Weekly activation reaches sixty per cent",
    baselineValue: 41,
  };

  it("reports a finished plan whose measure has not moved, naming both figures", () => {
    const found = linkedWorkDivergence({
      ...base,
      work: { done: 4, total: 4 },
      currentValue: 41,
    });
    expect(found).not.toBeNull();
    // Both numbers, because either alone invites a shrug and together they are
    // a question somebody has to answer.
    expect(found?.reason).toContain("4 of 4 linked tasks complete");
    expect(found?.reason).toContain("41");
    expect(found?.reason).toContain(base.keyResultTitle);
  });

  it("says nothing while any of the work is unfinished", () => {
    // A plan in progress is not evidence of anything yet.
    expect(
      linkedWorkDivergence({
        ...base,
        work: { done: 3, total: 4 },
        currentValue: 41,
      }),
    ).toBeNull();
  });

  it("says nothing when the measure has moved, however little", () => {
    expect(
      linkedWorkDivergence({
        ...base,
        work: { done: 4, total: 4 },
        currentValue: 41.5,
      }),
    ).toBeNull();
  });

  it("says nothing about a key result with no work behind it", () => {
    // Nothing was planned, so nothing was proved by nothing happening.
    expect(
      linkedWorkDivergence({
        ...base,
        work: { done: 0, total: 0 },
        currentValue: 41,
      }),
    ).toBeNull();
  });

  it("reads as a sentence for a single task", () => {
    const found = linkedWorkDivergence({
      ...base,
      work: { done: 1, total: 1 },
      currentValue: 41,
    });
    expect(found?.reason).toContain("1 of 1 linked task complete");
  });

  it("is medium, not high", () => {
    // A champion reporting a goal healthy against its own progress has said
    // something untrue, which is `divergence.ts`'s high case. This is a team
    // that did what they planned and did not get what they wanted. Grading them
    // the same would make the high band mean less.
    expect(
      linkedWorkDivergence({
        ...base,
        work: { done: 2, total: 2 },
        currentValue: 41,
      })?.severity,
    ).toBe("medium");
  });
});
