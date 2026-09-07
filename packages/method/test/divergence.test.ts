import { describe, expect, it } from "vitest";
import { averageConfidence, divergences } from "../src/divergence.ts";
import { resolveThresholds } from "../src/thresholds.ts";

/**
 * Divergence between reported health and the data (P4-T06b-a).
 *
 * Pure, and reading only §11 parameters that already existed: §3.7's progress
 * signal boundaries and §3.2's confidence bands. METHOD.md defines no divergence
 * rule and §11 carries no threshold for one, so a test that pinned a number of
 * its own would be pinning invented practice.
 */

const thresholds = resolveThresholds({});

describe("progress contradicting health", () => {
  it("fires when a goal is reported on track and its progress is red", () => {
    const found = divergences(
      { health: "on_track", signal: "red", averageConfidence: null },
      thresholds,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("progress_contradicts_health");
    // High: this is the case nobody finds out about until the cycle ends.
    expect(found[0]?.severity).toBe("high");
    expect(found[0]?.reason.length).toBeGreaterThan(0);
  });

  it("says nothing about amber, which is most of a cycle", () => {
    expect(
      divergences(
        { health: "on_track", signal: "amber", averageConfidence: null },
        thresholds,
      ),
    ).toEqual([]);
  });

  it("says nothing when the champion is already reporting trouble", () => {
    // Red progress beside a `caution` status is agreement, not divergence.
    for (const health of ["caution", "off_track"] as const) {
      expect(
        divergences(
          { health, signal: "red", averageConfidence: null },
          thresholds,
        ),
      ).toEqual([]);
    }
  });

  it("says nothing about a status that claims nothing", () => {
    // `pending` has never been reported and `outdated` is the product's own
    // verdict that nobody reported lately. Neither can contradict anything.
    for (const health of ["pending", "outdated"] as const) {
      expect(
        divergences(
          { health, signal: "red", averageConfidence: null },
          thresholds,
        ),
      ).toEqual([]);
    }
  });

  it("says nothing when nothing is measurable yet", () => {
    expect(
      divergences(
        { health: "on_track", signal: null, averageConfidence: null },
        thresholds,
      ),
    ).toEqual([]);
  });

  it("stays quiet on a closed goal's own statuses", () => {
    for (const health of ["achieved", "missed"] as const) {
      expect(
        divergences(
          { health, signal: "red", averageConfidence: null },
          thresholds,
        ),
      ).toEqual([]);
    }
  });
});

describe("confidence contradicting health", () => {
  it("fires when on track meets confidence below the low band", () => {
    const found = divergences(
      { health: "on_track", signal: "green", averageConfidence: 0.3 },
      thresholds,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("confidence_contradicts_health");
    expect(found[0]?.severity).toBe("high");
  });

  it("fires the other way when caution meets confidence in the high band", () => {
    const found = divergences(
      { health: "caution", signal: "green", averageConfidence: 0.8 },
      thresholds,
    );
    expect(found).toHaveLength(1);
    // Medium: nobody is being misled about progress, but the two signals still
    // disagree.
    expect(found[0]?.severity).toBe("medium");
  });

  it("respects the boundaries as §11 states them", () => {
    // Low is 0.4 and the comparison is strict, so exactly 0.4 is not below it.
    expect(
      divergences(
        { health: "on_track", signal: "green", averageConfidence: 0.4 },
        thresholds,
      ),
    ).toEqual([]);
    // High is 0.7 and includes its boundary.
    expect(
      divergences(
        { health: "caution", signal: "green", averageConfidence: 0.7 },
        thresholds,
      ),
    ).toHaveLength(1);
  });

  it("moves with the parameters rather than with numbers in here", () => {
    const moved = resolveThresholds({ "scoring.confidenceLow": 0.6 });
    expect(
      divergences(
        { health: "on_track", signal: "green", averageConfidence: 0.5 },
        moved,
      ),
    ).toHaveLength(1);
    expect(
      divergences(
        { health: "on_track", signal: "green", averageConfidence: 0.5 },
        thresholds,
      ),
    ).toEqual([]);
  });

  it("says nothing while nobody has answered", () => {
    expect(
      divergences(
        { health: "on_track", signal: "green", averageConfidence: null },
        thresholds,
      ),
    ).toEqual([]);
  });
});

describe("both at once", () => {
  it("returns two findings when progress and confidence both contradict", () => {
    const found = divergences(
      { health: "on_track", signal: "red", averageConfidence: 0.2 },
      thresholds,
    );
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.kind)).toEqual([
      "progress_contradicts_health",
      "confidence_contradicts_health",
    ]);
  });
});

describe("averageConfidence", () => {
  it("ignores the unanswered rather than counting them as zero", () => {
    // KR-6 stays `todo` on an unanswered key result for the same reason:
    // nobody said they were unconfident, they said nothing, and averaging that
    // as zero would manufacture a divergence.
    expect(averageConfidence([0.8, null, 0.6])).toBeCloseTo(0.7);
  });

  it("is null when nothing has been answered at all", () => {
    expect(averageConfidence([null, null])).toBeNull();
    expect(averageConfidence([])).toBeNull();
  });

  it("is the value itself for one answer", () => {
    expect(averageConfidence([0.55])).toBe(0.55);
  });
});
