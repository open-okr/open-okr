import { describe, expect, it } from "vitest";
import { DIFF_LINE_LIMIT, diffLines } from "../src/rich-text/diff.ts";

/**
 * The visual difference between two document versions (TECHNICAL-PLAN §4.9,
 * P5-T12).
 *
 * A line at a time, over plain text the shared rich-text module extracted. The
 * tests that matter are the ones about what a reader is told when nothing
 * changed and when the comparison was too big to attempt: both are cases where
 * an over-eager answer would say something untrue.
 */

const lines = (result: ReturnType<typeof diffLines>) =>
  result.lines.map((line) => `${line.kind}:${line.text}`);

describe("what changed between two versions", () => {
  it("says nothing changed when nothing did", () => {
    const result = diffLines("One\nTwo", "One\nTwo");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(lines(result)).toEqual(["same:One", "same:Two"]);
  });

  it("names an added line without touching the ones around it", () => {
    const result = diffLines("One\nThree", "One\nTwo\nThree");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(lines(result)).toEqual(["same:One", "added:Two", "same:Three"]);
  });

  it("names a removed line", () => {
    const result = diffLines("One\nTwo\nThree", "One\nThree");
    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(lines(result)).toEqual(["same:One", "removed:Two", "same:Three"]);
  });

  it("reads a rewrite as one line out and one line in", () => {
    const result = diffLines("First draft.", "Second draft.");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("handles an empty side without inventing anything", () => {
    expect(diffLines("", "One").added).toBe(1);
    expect(diffLines("One", "").removed).toBe(1);
    expect(diffLines("", "")).toEqual({
      lines: [],
      added: 0,
      removed: 0,
      truncated: false,
    });
  });

  it("ignores trailing spaces and repeated blank lines", () => {
    // Editor JSON round-trips leave both behind, and neither is an edit
    // anybody made.
    const result = diffLines("One   \n\n\nTwo", "One\n\nTwo");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("refuses to guess on something too large, and says so", () => {
    const huge = Array.from(
      { length: DIFF_LINE_LIMIT + 1 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const result = diffLines("One", huge);
    // The new text, marked unchanged, with `truncated` telling the caller not
    // to draw it as a comparison. An unfinished comparison shown as a finished
    // one would tell somebody nothing changed.
    expect(result.truncated).toBe(true);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.lines.every((line) => line.kind === "same")).toBe(true);
  });
});
