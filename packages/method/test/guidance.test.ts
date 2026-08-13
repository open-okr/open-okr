import { describe, expect, it } from "vitest";
import {
  guidanceForPhase,
  HORIZONS,
  PHASE_GUIDANCE,
  SUGGESTED_TIMELINE,
} from "../src/guidance.ts";
import { PHASE_TITLES } from "../src/workflow.ts";

/**
 * Facilitator guidance as data (METHOD.md §9, P3-T03).
 *
 * The comparison against METHOD.md itself is P4-T01's `pnpm method:check`.
 * These tests guard the invariants a surface depends on: every phase has
 * guidance, the titles agree with the ones the phase evaluator already
 * publishes, and no sentence carries the punctuation a renderer is about to
 * add.
 */

describe("every phase has guidance", () => {
  it("covers 0 to 7 in order", () => {
    expect(PHASE_GUIDANCE.map((entry) => entry.phase)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("uses the same titles the phase evaluator publishes", () => {
    // Two lists of eight phase names in one product is one list too many. If
    // §2.2 is ever renamed in one place only, this fails rather than shipping a
    // rail that disagrees with its own panel heading.
    expect(PHASE_GUIDANCE.map((entry) => entry.title)).toEqual([
      ...PHASE_TITLES,
    ]);
  });

  it("names an output for each", () => {
    for (const entry of PHASE_GUIDANCE) {
      expect(entry.output.length).toBeGreaterThan(0);
    }
  });

  it("carries at least three directives per phase", () => {
    for (const entry of PHASE_GUIDANCE) {
      expect(entry.guidance.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves the final punctuation to whoever renders it", () => {
    for (const entry of PHASE_GUIDANCE) {
      for (const line of entry.guidance) {
        expect(line.endsWith(".")).toBe(false);
        expect(line.trim()).toBe(line);
      }
    }
  });

  it("looks a phase up, and reports an unknown one as unknown", () => {
    expect(guidanceForPhase(1)?.title).toBe("Prepare");
    expect(guidanceForPhase(8)).toBeUndefined();
    expect(guidanceForPhase(-1)).toBeUndefined();
  });
});

describe("the two horizons", () => {
  it("describes both, completely", () => {
    for (const mode of ["annual", "quarterly"] as const) {
      const horizon = HORIZONS[mode];
      expect(horizon.runs.length).toBeGreaterThan(0);
      expect(horizon.sets.length).toBeGreaterThan(0);
      expect(horizon.revisited.length).toBeGreaterThan(0);
      expect(horizon.note.length).toBeGreaterThan(0);
    }
  });

  it("tells a quarterly facilitator the frame is not theirs to rewrite", () => {
    // §2.1's closing sentence is the one a quarterly cycle most often ignores,
    // so a mode note that dropped it would be missing the point of having one.
    expect(HORIZONS.quarterly.note).toContain("does not rewrite it");
  });
});

describe("the suggested timeline", () => {
  it("is shorter for a quarterly cycle than an annual one", () => {
    expect(SUGGESTED_TIMELINE.quarterly.length).toBeLessThan(
      SUGGESTED_TIMELINE.annual.length,
    );
  });

  it("gives every row a distance and an activity", () => {
    for (const mode of ["annual", "quarterly"] as const) {
      for (const row of SUGGESTED_TIMELINE[mode]) {
        expect(row.weeksBefore.length).toBeGreaterThan(0);
        expect(row.activity.length).toBeGreaterThan(0);
      }
    }
  });
});
