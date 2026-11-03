import { describe, expect, it } from "vitest";
import { PRACTICE, PRACTICE_KEYS } from "../src/practice.ts";
import { METHOD_SECTIONS, methodSectionAnchor } from "../src/sections.ts";
import { THRESHOLD_KEYS, THRESHOLDS } from "../src/thresholds.ts";

/**
 * METHOD.md's headings, for linking a reader to the exact section.
 *
 * `pnpm method:check` holds the table to the document. What is proved here is
 * that the anchors are the ones a Markdown renderer gives those headings, and
 * that nothing in the package cites a section the table does not have.
 */

const cited = (citation: string) =>
  citation.split(",").map((section) => section.trim());

describe("section anchors", () => {
  it("are the anchors the rendered document gives its headings", () => {
    expect(methodSectionAnchor("2.9")).toBe(
      "29-writing-and-changing-okrs-at-any-time",
    );
    expect(methodSectionAnchor("12")).toBe("12-practice-settings-and-profiles");
    expect(methodSectionAnchor("12.3")).toBe("123-the-profiles-compared");
    expect(methodSectionAnchor("3")).toBe("3-scoring-confidence-and-health");
    expect(methodSectionAnchor("8.8")).toBe("88-keep-modify-abandon-or-defer");
  });

  it("link a citation of several sections to the first", () => {
    expect(methodSectionAnchor("4.1, 4.2")).toBe("41-objective-checks");
  });

  it("are null for a section the document does not have", () => {
    expect(methodSectionAnchor("99.9")).toBeNull();
  });
});

describe("citations", () => {
  it("name only sections the document has, for every setting and threshold", () => {
    for (const key of PRACTICE_KEYS) {
      for (const section of cited(PRACTICE[key].section)) {
        expect(METHOD_SECTIONS, key).toHaveProperty([section]);
      }
    }
    for (const key of THRESHOLD_KEYS) {
      for (const section of cited(THRESHOLDS[key].section)) {
        expect(METHOD_SECTIONS, key).toHaveProperty([section]);
      }
    }
  });

  it("send a check's setting to its own group of checks", () => {
    expect(PRACTICE["checks.OBJ-1"].section).toBe("4.1");
    expect(PRACTICE["checks.KR-3"].section).toBe("4.2");
    expect(PRACTICE["checks.AL-3"].section).toBe("4.3");
    expect(PRACTICE["checks.CY-8"].section).toBe("4.4");
  });
});
