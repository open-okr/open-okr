import { describe, expect, it } from "vitest";
import { keyResultDraft, objectiveDraft } from "../src/addition.ts";
import { defaultPractice, resolvePractice } from "../src/practice.ts";
import type { KeyResultInput } from "../src/quality.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * Live or draft, under "Live" (METHOD.md §2.9, P9-T13-b-a).
 *
 * An addition is live once it passes the checks set to block, and a draft
 * until then, with what is missing named. These pin which checks count, and
 * that the missing fields are named rather than KR-3's whole sentence.
 */

const thresholds = canonThresholds();
const practice = defaultPractice();

/** NW-Q3-11's G1.2, complete. */
const complete: KeyResultInput = {
  text: "Self-serve trial-to-paid conversion from 4.1% to 7%",
  baseline: 4.1,
  target: 7,
  dueOn: "2026-09-30",
  ownerId: "yuki",
  indicatorType: "lagging",
  direction: "increase",
  confidence: null,
  keyResultKind: "metric",
};

const objective = {
  title: "Make self-serve a second engine of growth",
  hasCycle: true,
  hasTimeframe: false,
  championId: "yuki",
  reviewerId: null,
  level: "team" as const,
};

describe("a key result added mid-cycle", () => {
  it("is live at once with its target, due date and owner (NW-Q3-11)", () => {
    expect(keyResultDraft(complete, thresholds, practice)).toBeNull();
  });

  it("is a draft without its target, and says so", () => {
    expect(
      keyResultDraft({ ...complete, target: null }, thresholds, practice),
    ).toEqual({ missing: ["target"], failing: [] });
  });

  it("names every field KR-3 found missing, in the order a writer meets them", () => {
    expect(
      keyResultDraft(
        { ...complete, target: null, dueOn: null, ownerId: null },
        thresholds,
        practice,
      ),
    ).toEqual({ missing: ["target", "dueDate", "owner"], failing: [] });
  });

  it("does not ask a milestone or a baseline for a target", () => {
    for (const keyResultKind of ["milestone", "baseline"] as const) {
      expect(
        keyResultDraft(
          { ...complete, keyResultKind, target: null, baseline: null },
          thresholds,
          practice,
        ),
      ).toBeNull();
    }
  });

  it("is not held back by a check at warn", () => {
    // KR-2 warns on a metric with no numbers in its words.
    expect(
      keyResultDraft(
        { ...complete, text: "Self-serve conversion improves" },
        thresholds,
        practice,
      ),
    ).toBeNull();
  });

  it("is held back by a check the workspace raised to block, named by id", () => {
    const raised = resolvePractice("recommended", { "checks.KR-2": "block" });
    expect(
      keyResultDraft(
        { ...complete, text: "Self-serve conversion improves" },
        thresholds,
        raised,
      ),
    ).toEqual({ missing: [], failing: ["KR-2"] });
  });

  it("is held back by every check under strict mode", () => {
    expect(
      keyResultDraft(
        { ...complete, text: "Self-serve conversion improves" },
        thresholds,
        practice,
        { strict: true },
      ),
    ).toEqual({ missing: [], failing: ["KR-2"] });
  });

  it("is live whatever its check says, once the workspace turned the check off", () => {
    const off = resolvePractice("recommended", { "checks.KR-3": "off" });
    expect(
      keyResultDraft({ ...complete, target: null }, thresholds, off),
    ).toBeNull();
  });
});

describe("an objective added mid-cycle", () => {
  it("is live with its champion and one key result (NW-Q3-09)", () => {
    expect(
      objectiveDraft(
        objective,
        [{ ...complete, keyResultKind: "baseline" }],
        thresholds,
        practice,
      ),
    ).toBeNull();
  });

  it("is a draft with no key result yet, and names it", () => {
    expect(objectiveDraft(objective, [], thresholds, practice)).toEqual({
      missing: ["keyResult"],
      failing: [],
    });
  });

  it("is a draft without a reviewer where the workspace requires one", () => {
    const required = resolvePractice("recommended", { reviewer: "required" });
    expect(
      objectiveDraft(
        { ...objective, reviewerRequired: true },
        [complete],
        thresholds,
        required,
      ),
    ).toEqual({ missing: ["reviewer"], failing: [] });
  });

  it("is not held back by what its key results lack, which is theirs", () => {
    expect(
      objectiveDraft(
        objective,
        [{ ...complete, target: null }],
        thresholds,
        practice,
      ),
    ).toBeNull();
  });

  it("leaves the count of objectives in its unit to the gates, even when strict", () => {
    expect(
      objectiveDraft(
        { ...objective, title: "Grow self-serve revenue to a second engine" },
        [complete, { ...complete, indicatorType: "leading" }],
        thresholds,
        practice,
        { strict: true },
      )?.failing ?? [],
    ).not.toContain("OBJ-5");
  });
});
