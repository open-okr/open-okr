import { describe, expect, it } from "vitest";
import {
  healthyBoundaryOf,
  type KpiTargetType,
  type KpiThresholds,
  kpiReading,
  NO_THRESHOLDS,
  thresholdsProblem,
} from "../src/kpi.ts";
import { aggregateForPeriod } from "../src/kpi-aggregate.ts";
import {
  draftRecovery,
  shouldProposeRecoveryClose,
} from "../src/kpi-recovery.ts";
import { trendForecast } from "../src/scoring.ts";

/**
 * A KPI judged in its own units, by its own kind of target (METHOD.md §6.2,
 * §6.4, P9-T17a), against the four cases METHOD-REVIEW §3.6 found the ratio
 * getting wrong, and the Northwind year's own readings.
 */

const corridor = { healthyPct: 90, watchPct: 70 };

const read = (
  targetType: KpiTargetType,
  thresholds: Partial<KpiThresholds>,
  actual: number | null,
  target: number | null = null,
) =>
  kpiReading({
    targetType,
    thresholds: { ...NO_THRESHOLDS, ...thresholds },
    actual,
    target,
    corridor,
  });

describe("the cases METHOD-REVIEW §3.6 found the ratio getting wrong", () => {
  it("acceptance: uptime at 95 against 99.9 with red below 99.5 is unhealthy", () => {
    const uptime = read("at_least", { greenLow: 99.9, redLow: 99.5 }, 95, 99.9);
    expect(uptime).toMatchObject({ band: "unhealthy", basis: "thresholds" });
    // The ratio called it healthy, which is the whole defect.
    expect(read("at_least", {}, 95, 99.9).band).toBe("healthy");
  });

  it("uptime as a range of 99.9 to 100 with red below 99.5 (NW-P-12, NW-Q4-04)", () => {
    const uptime = (actual: number) =>
      read("range", { greenLow: 99.9, greenHigh: 100, redLow: 99.5 }, actual)
        .band;
    expect(uptime(99.95)).toBe("healthy");
    expect(uptime(99.7)).toBe("watch");
    expect(uptime(99.4)).toBe("unhealthy");
    // A range has no ratio: there is no single target to divide by.
    expect(
      read("range", { greenLow: 99.9, greenHigh: 100 }, 99.95).achievementPct,
    ).toBeNull();
  });

  it("a 1 to 5 rating is judged on the scale, not as a share of the target", () => {
    const csat = (actual: number) =>
      read("at_least", { greenLow: 4.2, redLow: 3.5 }, actual, 4.5).band;
    expect(csat(3.2)).toBe("unhealthy");
    expect(csat(3.8)).toBe("watch");
    expect(csat(4.3)).toBe("healthy");
  });

  it("a net promoter score below zero has a band", () => {
    const nps = (actual: number) =>
      read("increase_to", { greenLow: 0, redLow: -20 }, actual, -5).band;
    expect(nps(-12)).toBe("watch");
    expect(nps(-30)).toBe("unhealthy");
    expect(nps(4)).toBe("healthy");
    // The ratio refuses a negative target outright.
    expect(read("increase_to", {}, -12, -5)).toMatchObject({
      band: null,
      diagnostic: "negative_target",
    });
  });

  it("defects against a target of none: one is watch, three is unhealthy", () => {
    const defects = (actual: number) =>
      read("at_most", { greenHigh: 0, redHigh: 2 }, actual, 0).band;
    expect(defects(0)).toBe("healthy");
    expect(defects(1)).toBe("watch");
    expect(defects(3)).toBe("unhealthy");
  });
});

describe("the Northwind readings (NW-P-12, NW-Q1-17, NW-Q3-03)", () => {
  it("green is inclusive and red is strict", () => {
    const margin = (actual: number) =>
      read("increase_to", { greenLow: 13.5, redLow: 8 }, actual, 15).band;
    expect(margin(13.5)).toBe("healthy");
    expect(margin(9.1)).toBe("watch");
    expect(margin(8)).toBe("watch");
    expect(margin(7.6)).toBe("unhealthy");

    const tickets = (actual: number) =>
      read("decrease_to", { greenHigh: 2.2, redHigh: 3.2 }, actual, 2).band;
    expect(tickets(2.9)).toBe("watch");
    expect(tickets(3.2)).toBe("watch");
    expect(tickets(3.3)).toBe("unhealthy");
  });

  it("no value is no data, whatever the rule", () => {
    expect(read("at_least", { greenLow: 1, redLow: 0 }, null).band).toBeNull();
    expect(read("at_least", {}, null, 10).band).toBeNull();
  });
});

describe("the ratio fallback", () => {
  it("applies with no thresholds, and says so", () => {
    expect(read("at_least", {}, 95, 100)).toMatchObject({
      band: "healthy",
      basis: "ratio",
      achievementPct: 95,
    });
    expect(read("at_most", {}, 120, 100).band).toBe("watch");
  });

  it("applies with half a rule too, rather than judging by it", () => {
    expect(read("at_least", { greenLow: 50 }, 40, 100).basis).toBe("ratio");
  });
});

describe("thresholds a type cannot be judged by are refused in words", () => {
  const problem = (type: KpiTargetType, t: Partial<KpiThresholds>) =>
    thresholdsProblem(type, { ...NO_THRESHOLDS, ...t });

  it("accepts none, a complete pair, and a range's band alone", () => {
    expect(problem("at_least", {})).toBeNull();
    expect(problem("at_least", { greenLow: 10, redLow: 5 })).toBeNull();
    expect(problem("range", { greenLow: 99.9, greenHigh: 100 })).toBeNull();
  });

  it("refuses half a pair, a red on the wrong side, and a range without its band", () => {
    expect(problem("at_least", { greenLow: 10 })).toMatch(/both/);
    expect(problem("at_least", { greenLow: 5, redLow: 10 })).toMatch(/below/);
    expect(problem("at_most", { greenHigh: 10, redHigh: 5 })).toMatch(/above/);
    expect(problem("range", {})).toMatch(/needs its band/);
    expect(problem("range", { greenLow: 100, greenHigh: 99 })).toMatch(
      /above its top/,
    );
    expect(
      problem("range", { greenLow: 99, greenHigh: 100, redLow: 99.5 }),
    ).toMatch(/below sits above/);
  });
});

describe("a recovery closes on the real band where thresholds decide it", () => {
  it("proposes closing once the KPI is back inside its green boundary", () => {
    const close = (band: "healthy" | "watch") =>
      shouldProposeRecoveryClose({
        // The ratio would say no either way; the band decides.
        achievementPct: 10,
        recovery: "open",
        alreadyProposed: false,
        healthyPct: 90,
        band,
      });
    expect(close("healthy")).toBe(true);
    expect(close("watch")).toBe(false);
  });
});

describe("last and first, for a balance or a headcount (§6.2)", () => {
  const days = [
    { periodStart: "2026-03-31", value: 31 },
    { periodStart: "2026-03-01", value: 1 },
    { periodStart: "2026-03-15", value: 15 },
  ];
  it("take the period's end and start, in period order", () => {
    expect(
      aggregateForPeriod("daily", "monthly", "last", days, "2026-03-01"),
    ).toBe(31);
    expect(
      aggregateForPeriod("daily", "monthly", "first", days, "2026-03-01"),
    ).toBe(1);
    expect(
      aggregateForPeriod("daily", "monthly", "last", [], "2026-03-01"),
    ).toBeNull();
  });
});

describe("where a KPI is healthy again (§6.5, P9-T18a)", () => {
  const boundary = (
    targetType: KpiTargetType,
    thresholds: Partial<KpiThresholds>,
    target: number | null,
    current: number | null = null,
  ) =>
    healthyBoundaryOf({
      targetType,
      thresholds: { ...NO_THRESHOLDS, ...thresholds },
      target,
      current,
      corridor,
    });

  it("is the green value where thresholds decide (NW-Q3-04: 7.6% to 13.5%)", () => {
    expect(boundary("increase_to", { greenLow: 13.5, redLow: 8 }, 15)).toBe(
      13.5,
    );
    expect(boundary("decrease_to", { greenHigh: 2.2, redHigh: 3.2 }, 2)).toBe(
      2.2,
    );
  });

  it("is the nearer end of a range", () => {
    const band = { greenLow: 99.9, greenHigh: 100, redLow: 99.5 };
    expect(boundary("range", band, null, 99.4)).toBe(99.9);
    expect(boundary("range", band, null, 100.5)).toBe(100);
  });

  it("is the healthy share of the target on the fallback, and null with neither", () => {
    expect(boundary("at_least", {}, 100)).toBe(90);
    // Lower is better: 90% achievement is target over actual, so the actual
    // may be up to a ninth above the target.
    expect(boundary("at_most", {}, 90)).toBe(100);
    expect(boundary("at_least", {}, null)).toBeNull();
  });
});

describe("the recovery's first key result points back to the band", () => {
  it("comes down to a range KPI's band from above, whatever direction its row holds", () => {
    // Band 40 to 60, reading 90: the row was left at higher_better, and the
    // way back is down.
    const draft = draftRecovery(
      {
        root: {
          id: "kpi",
          title: "Queue length",
          target: 50,
          current: 90,
          direction: "higher_better",
          healthyBoundary: 60,
          owner: "m1",
        },
        nodes: [],
      },
      4,
    );
    expect(draft.keyResults[0]).toMatchObject({
      direction: "reduce",
      baseline: 90,
      target: 60,
    });
  });

  it("goes up to the band from below", () => {
    const draft = draftRecovery(
      {
        root: {
          id: "kpi",
          title: "Queue length",
          target: 50,
          current: 20,
          direction: "lower_better",
          healthyBoundary: 40,
        },
        nodes: [],
      },
      4,
    );
    expect(draft.keyResults[0]?.direction).toBe("increase");
  });
});

describe("§3.6's forecast for a move that points down", () => {
  it("flags a projection stuck above a target below the baseline", () => {
    const points = [
      { at: 0, value: 92 },
      { at: 1, value: 91 },
      { at: 2, value: 90 },
      { at: 3, value: 89 },
    ];
    expect(
      trendForecast(points, 10, {
        direction: "move",
        baseline: 100,
        target: 50,
      })?.trendingOffTrack,
    ).toBe(true);
  });
});
