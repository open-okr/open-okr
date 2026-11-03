import { describe, expect, it } from "vitest";
import { PRACTICE, PRACTICE_KEYS } from "../src/practice.ts";
import { OPERATING_PRINCIPLES, principlesCited } from "../src/principles.ts";
import { THRESHOLD_KEYS, THRESHOLDS } from "../src/thresholds.ts";

/**
 * METHOD.md §1's operating principles, for a screen that cites one.
 *
 * A threshold's reason says "(principle 5)", and a reader without METHOD.md
 * open cannot know what principle 5 is. `pnpm method:check` holds the titles
 * to the document; this proves the citations can be found and all resolve.
 */

describe("the operating principles", () => {
  it("are the twelve METHOD.md numbers, in order, each with its title", () => {
    expect(OPERATING_PRINCIPLES.map((principle) => principle.number)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(OPERATING_PRINCIPLES[4]?.title).toBe("The rhythm is the product.");
  });
});

describe("finding a cited principle", () => {
  it("reads the principles a sentence cites, once each, in the order cited", () => {
    expect(principlesCited("A week (principle 5) is short.")).toEqual([5]);
    expect(
      principlesCited(
        "Focus (principle 3), and again principle 10, then principle 3.",
      ),
    ).toEqual([3, 10]);
    expect(principlesCited("No citation here.")).toEqual([]);
  });

  it("finds only principles that exist, in every reason and summary the screens show", () => {
    const numbers = new Set(OPERATING_PRINCIPLES.map((p) => p.number));
    const texts = [
      ...THRESHOLD_KEYS.map((key) => THRESHOLDS[key].why),
      ...PRACTICE_KEYS.map((key) => PRACTICE[key].summary),
    ];
    let cited = 0;
    for (const text of texts) {
      for (const number of principlesCited(text)) {
        expect(numbers, text).toContain(number);
        cited += 1;
      }
    }
    // Four reasons cite a principle today. A floor, so a pattern that
    // quietly found nothing fails.
    expect(cited).toBeGreaterThanOrEqual(4);
  });
});
