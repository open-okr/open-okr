import { describe, expect, it } from "vitest";
import {
  type CascadeGoal,
  cascadeProgress,
  keyResultProgress,
  weightedProgress,
} from "../src/scoring.ts";
import { canonThresholds, resolveThresholds } from "../src/thresholds.ts";

/**
 * The progress ceiling (METHOD.md §3.1 and §11, P8-G03).
 *
 * Progress was clamped to 100 by a constant. It is a §11 parameter now, so a
 * workspace that wants over-achievement on the page can have it, and one that
 * does not sees exactly what it saw before.
 *
 * **The default is the interesting half.** Everything that worked before this
 * parameter existed has to keep working, so every assertion below is written
 * twice: once at the canon default, where the answer is the old answer, and once
 * at a raised ceiling, where it is not.
 *
 * **The ceiling reaches the goal rollup, which was Agung's decision on
 * 22 September 2026 and not the recommendation.** A goal holding one key result
 * at 150% and one at 50% averages 100% and reads as complete while half the work
 * was missed. The test at the bottom asserts that arithmetic on purpose, so
 * nobody reads it later as an accident.
 */

const canon = canonThresholds();
const raised = resolveThresholds({ "scoring.progressCeilingPct": 200 });

describe("the ceiling's default is the behaviour that shipped before it", () => {
  it("is 100", () => {
    expect(canon["scoring.progressCeilingPct"]).toBe(100);
  });

  it("holds an increase key result past its target at 100", () => {
    expect(
      keyResultProgress(
        { direction: "increase", baseline: 0, target: 100, current: 150 },
        canon,
      ),
    ).toBe(100);
  });

  it("holds a reduce key result past its target at 100", () => {
    expect(
      keyResultProgress(
        { direction: "reduce", baseline: 100, target: 50, current: 25 },
        canon,
      ),
    ).toBe(100);
  });

  it("holds a KPI-linked key result at 100 although the KPI reads 180", () => {
    expect(
      keyResultProgress(
        {
          direction: "increase",
          baseline: 0,
          target: 100,
          current: 0,
          kpiAchievementPct: 180,
        },
        canon,
      ),
    ).toBe(100);
  });

  it("holds a weighted rollup at 100", () => {
    expect(weightedProgress([{ weight: 1, progressPct: 150 }], canon)).toBe(
      100,
    );
  });
});

describe("a raised ceiling lets over-achievement through", () => {
  it("reports an increase key result at 150 of a 100 target as 150%", () => {
    expect(
      keyResultProgress(
        { direction: "increase", baseline: 0, target: 100, current: 150 },
        raised,
      ),
    ).toBe(150);
  });

  it("reports a reduce key result that halved again as 150%", () => {
    // Baseline 100, target 50, so the span is 50. Landing at 25 travelled 75.
    expect(
      keyResultProgress(
        { direction: "reduce", baseline: 100, target: 50, current: 25 },
        raised,
      ),
    ).toBe(150);
  });

  it("carries a KPI's own achievement through instead of cutting it to 100", () => {
    // §6.4 already allows a KPI 0 to 200. Before this parameter the link threw
    // away everything above 100, so a KPI at 180 and one at exactly 100 were
    // indistinguishable on the key result that measured them.
    expect(
      keyResultProgress(
        {
          direction: "increase",
          baseline: 0,
          target: 100,
          current: 0,
          kpiAchievementPct: 180,
        },
        raised,
      ),
    ).toBe(180);
  });

  it("still stops at the ceiling, and the ceiling is 200", () => {
    expect(
      keyResultProgress(
        { direction: "increase", baseline: 0, target: 100, current: 400 },
        raised,
      ),
    ).toBe(200);
  });

  it("still floors at 0 when a measure moved backwards", () => {
    expect(
      keyResultProgress(
        { direction: "increase", baseline: 50, target: 100, current: 10 },
        raised,
      ),
    ).toBe(0);
  });

  it("refuses a ceiling below 100 and falls back to the canon default", () => {
    // `resolveThresholds` drops an override that fails its schema rather than
    // throwing, so a stored 40 reads as 100. A ceiling under 100 would make a
    // key result that hit its target read as more than achieved.
    const floored = resolveThresholds({ "scoring.progressCeilingPct": 40 });
    expect(floored["scoring.progressCeilingPct"]).toBe(100);
  });

  it("refuses a ceiling above 200, the limit §6.4 already applies to a KPI", () => {
    const capped = resolveThresholds({ "scoring.progressCeilingPct": 500 });
    expect(capped["scoring.progressCeilingPct"]).toBe(100);
  });
});

describe("the maintain band under a raised ceiling", () => {
  it("still reads 100 inside the band, because inside is the whole answer", () => {
    // A maintain key result has no notion of over-achievement: the value is in
    // the band or it is on its way back. Raising the ceiling must not invent a
    // number above 100 here.
    expect(
      keyResultProgress(
        { direction: "maintain", baseline: 90, target: 110, current: 100 },
        raised,
      ),
    ).toBe(100);
    expect(
      keyResultProgress(
        { direction: "maintain", baseline: 90, target: 110, current: 110 },
        raised,
      ),
    ).toBe(100);
  });

  it("still scales the distance back to the band", () => {
    expect(
      keyResultProgress(
        { direction: "maintain", baseline: 90, target: 110, current: 80 },
        raised,
      ),
    ).toBe(50);
  });
});

describe("the rollup carries over-achievement, and what that costs", () => {
  it("averages a 150% key result with a 50% one to 100%", () => {
    // Agung's decision, stated as arithmetic. The goal reads as complete and
    // the key result at 50% is invisible in the number.
    expect(
      weightedProgress(
        [
          { weight: 1, progressPct: 150 },
          { weight: 1, progressPct: 50 },
        ],
        raised,
      ),
    ).toBe(100);
  });

  it("carries a raised child's progress up the cascade at its weight", () => {
    const goals: readonly CascadeGoal[] = [
      {
        id: "parent",
        weight: 1,
        keyResults: [],
      },
      {
        id: "child",
        weight: 1,
        parentGoalId: "parent",
        keyResults: [{ id: "kr", weight: 1, progressPct: 150 }],
      },
    ];
    expect(cascadeProgress(goals, raised).goals.get("child")).toBe(150);
    expect(cascadeProgress(goals, raised).goals.get("parent")).toBe(150);
  });

  it("cuts the same cascade to 100 at the canon default", () => {
    const goals: readonly CascadeGoal[] = [
      {
        id: "parent",
        weight: 1,
        keyResults: [],
      },
      {
        id: "child",
        weight: 1,
        parentGoalId: "parent",
        keyResults: [{ id: "kr", weight: 1, progressPct: 150 }],
      },
    ];
    expect(cascadeProgress(goals, canon).goals.get("child")).toBe(100);
    expect(cascadeProgress(goals, canon).goals.get("parent")).toBe(100);
  });

  it("clamps a settled boundary node to the ceiling too", () => {
    // A partial load hands in a stored progress. It came from a write made
    // under whatever ceiling was in force then, so it is clamped on the way in
    // rather than trusted.
    const goals: readonly CascadeGoal[] = [
      { id: "settled", weight: 1, keyResults: [], settledProgressPct: 150 },
    ];
    expect(cascadeProgress(goals, canon).goals.get("settled")).toBe(100);
    expect(cascadeProgress(goals, raised).goals.get("settled")).toBe(150);
  });

  it("still reports 0 for a total weight of zero", () => {
    // Decision D-3, unchanged by the ceiling.
    expect(weightedProgress([{ weight: 0, progressPct: 150 }], raised)).toBe(0);
  });
});
