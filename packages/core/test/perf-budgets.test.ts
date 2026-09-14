import { describe, expect, it } from "vitest";
import { ACTION_MAP } from "../src/actions/registry.ts";
import { BUDGETS, percentile, statisticOf } from "../src/perf/budgets.ts";

/**
 * The §13.1 budget table (P7-T01b).
 *
 * The measuring itself is a command against the large dataset, because
 * building it takes ninety seconds and that does not belong in the unit
 * suite. What belongs here is the table's own integrity: that it still names
 * every row §13.1 does, that a row this harness claims to measure names an
 * action that exists, and that the statistic it is judged on is computed the
 * way the document says.
 */

describe("percentile", () => {
  it("is nearest-rank, so a p95 of twenty samples is the nineteenth", () => {
    const samples = Array.from({ length: 20 }, (_value, index) => index + 1);
    expect(percentile(samples, 0.95)).toBe(19);
    expect(percentile(samples, 0.5)).toBe(10);
  });

  it("does not care what order the samples arrive in", () => {
    expect(percentile([9, 1, 5, 3, 7], 0.5)).toBe(5);
  });

  it("answers zero for no samples rather than NaN", () => {
    // A NaN compares false against every ceiling, so a row that measured
    // nothing would report as passing.
    expect(percentile([], 0.95)).toBe(0);
  });

  it("takes the highest sample for a p95 of a short run", () => {
    expect(percentile([4, 8], 0.95)).toBe(8);
  });
});

describe("statisticOf", () => {
  it("reads p95 and median from the row's own choice", () => {
    const samples = [1, 2, 3, 4, 100];
    expect(statisticOf(samples, "median")).toBe(3);
    expect(statisticOf(samples, "p95")).toBe(100);
  });
});

describe("the budget table", () => {
  it("holds every row TECHNICAL-PLAN §13.1 lists", () => {
    // Fourteen. A row quietly dropped from this table would be a budget
    // nobody measures and nobody misses.
    expect(BUDGETS).toHaveLength(14);
  });

  it("gives every row a ceiling and a statistic", () => {
    for (const budget of BUDGETS) {
      expect(budget.ms, budget.surface).toBeGreaterThan(0);
      expect(["p95", "median"]).toContain(budget.statistic);
    }
  });

  it("names an action for every row it claims to measure here", () => {
    const missing = BUDGETS.filter(
      (budget) => budget.measuredBy === "here" && !budget.action,
    ).map((budget) => budget.surface);
    expect(missing).toEqual([]);
  });

  it("names a real action, except for the one pure function", () => {
    // `method.evaluateDraft` is timed in process rather than through the
    // registry, because §13.1's point about it is that it never reaches a
    // server at all.
    const unknown = BUDGETS.filter(
      (budget) =>
        budget.measuredBy === "here" &&
        budget.action !== undefined &&
        !budget.action.startsWith("method.") &&
        !Object.keys(ACTION_MAP).includes(budget.action),
    ).map((budget) => budget.action);
    expect(unknown).toEqual([]);
  });

  it("says who measures every row it does not", () => {
    const silent = BUDGETS.filter(
      (budget) => budget.measuredBy !== "here" && !budget.note,
    ).map((budget) => budget.surface);
    // A row handed to another task explains why, so the handover is a
    // decision somebody can disagree with rather than a blank.
    expect(silent).toEqual([]);
  });
});
