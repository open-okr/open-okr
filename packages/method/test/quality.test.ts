import { describe, expect, it } from "vitest";
import {
  evaluateObjective,
  OBJECTIVE_CHECKS,
  QUALITY_WORD_LISTS,
  strengthScore,
} from "../src/quality.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * The objective half of METHOD.md §4's quality catalogue (P4-T01).
 *
 * The cases are the corpus entries in `docs/design/p4-t00-method-package.md`
 * §15, which the human approved at the P4-T00 gate. They are the verdicts a
 * facilitator said were right, so they are what the engine has to produce.
 */

const thresholds = canonThresholds();

const verdict = (id: string, result: ReturnType<typeof evaluateObjective>) =>
  result.find((entry) => entry.id === id)?.status;

describe("the catalogue as data", () => {
  it("carries the five objective checks with their prompts", () => {
    expect(OBJECTIVE_CHECKS).toHaveLength(5);
    for (const check of OBJECTIVE_CHECKS) {
      expect(check.conditions.length).toBeGreaterThan(0);
      for (const row of check.conditions) {
        // A verdict with no coaching prompt is a rejection with no way out,
        // which is the one thing §4 never does.
        expect(row.prompt.length).toBeGreaterThan(20);
      }
    }
  });

  it("keeps the §4.1 word lists as data", () => {
    expect(QUALITY_WORD_LISTS.outputVerbs).toContain("launch");
    expect(QUALITY_WORD_LISTS.movementVerbs).toContain("increase");
    expect(QUALITY_WORD_LISTS.stateWords).toContain("become");
    expect(QUALITY_WORD_LISTS.whyMarkers).toContain("so that");
  });
});

describe("corpus entry 1: an output-shaped objective", () => {
  const result = evaluateObjective(
    {
      title: "Launch the new mobile app by end of Q3",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "team",
    },
    thresholds,
  );

  it("fails OBJ-1 because it starts with an output verb", () => {
    expect(verdict("OBJ-1", result)).toBe("fail");
  });

  it("passes the rest", () => {
    expect(verdict("OBJ-2", result)).toBe("pass");
    expect(verdict("OBJ-3", result)).toBe("pass");
    expect(verdict("OBJ-4", result)).toBe("pass");
    expect(verdict("OBJ-5", result)).toBe("pass");
  });
});

describe("corpus entry 2: a metric as the objective", () => {
  const result = evaluateObjective(
    {
      title: "Increase revenue by 30%",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "team",
    },
    thresholds,
  );

  it("fails OBJ-1: movement with no why is a key result in disguise", () => {
    expect(verdict("OBJ-1", result)).toBe("fail");
  });

  it("warns OBJ-2 on the digits", () => {
    expect(verdict("OBJ-2", result)).toBe("warn");
  });
});

describe("corpus entry 3: a strong outcome objective", () => {
  const result = evaluateObjective(
    {
      title: "Become the preferred platform for mid-market teams",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "company",
    },
    thresholds,
  );

  it("passes every check", () => {
    expect(result.every((entry) => entry.status === "pass")).toBe(true);
  });

  it("scores 100", () => {
    expect(strengthScore(result)).toBe(100);
  });
});

describe("the refusals that are not about wording", () => {
  const base = {
    title: "Become the preferred platform for mid-market teams",
    hasCycle: false,
    hasTimeframe: false,
    championId: "m1",
    reviewerId: "m2",
    objectivesInUnit: 1,
    level: "team" as const,
  };

  it("fails OBJ-3 with neither a cycle nor a timeframe", () => {
    expect(verdict("OBJ-3", evaluateObjective(base, thresholds))).toBe("fail");
  });

  it("fails OBJ-4 with no reviewer", () => {
    const result = evaluateObjective(
      { ...base, hasCycle: true, reviewerId: null },
      thresholds,
    );
    expect(verdict("OBJ-4", result)).toBe("fail");
  });

  it("warns OBJ-5 above three in a unit, and fails above five at company", () => {
    const warned = evaluateObjective(
      { ...base, hasCycle: true, objectivesInUnit: 4 },
      thresholds,
    );
    expect(verdict("OBJ-5", warned)).toBe("warn");
    const failed = evaluateObjective(
      { ...base, hasCycle: true, objectivesInUnit: 6, level: "company" },
      thresholds,
    );
    expect(verdict("OBJ-5", failed)).toBe("fail");
  });
});

describe("the strength score", () => {
  it("is METHOD.md's own formula: (passes + half the warns) over evaluated", () => {
    const result = evaluateObjective(
      {
        title: "Increase revenue by 30%",
        hasCycle: true,
        hasTimeframe: false,
        championId: "m1",
        reviewerId: "m2",
        objectivesInUnit: 1,
        level: "team",
      },
      thresholds,
    );
    // OBJ-1 fail, OBJ-2 warn, OBJ-3/4/5 pass: (3 + 0.5) / 5 = 70.
    expect(strengthScore(result)).toBe(70);
  });
});
