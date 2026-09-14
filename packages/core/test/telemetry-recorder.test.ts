import { afterEach, describe, expect, it } from "vitest";

import {
  ACCESS_LEVEL_NAMES,
  defaultMetrics,
  METRIC,
  type MetricLabels,
  NO_METRICS,
  OUTCOME,
  setDefaultMetrics,
} from "../src/telemetry/recorder.ts";

interface Recorded {
  readonly name: string;
  readonly labels: MetricLabels | undefined;
  readonly value: number;
}

function spyRecorder() {
  const counts: Recorded[] = [];
  const observations: Recorded[] = [];
  return {
    counts,
    observations,
    count(name: string, labels?: MetricLabels, by = 1) {
      counts.push({ name, labels, value: by });
    },
    observe(name: string, seconds: number, labels?: MetricLabels) {
      observations.push({ name, labels, value: seconds });
    },
    gauge() {
      // Not exercised here. The gauges belong to the relay, which owns the
      // query behind them, and `adapters/test/telemetry.test.ts` proves the
      // reader runs at scrape time.
    },
    span<T>(_name: string, _attributes: MetricLabels, fn: () => Promise<T>) {
      return fn();
    },
  };
}

afterEach(() => {
  setDefaultMetrics(NO_METRICS);
});

describe("the default recorder", () => {
  it("does nothing until a host installs one", () => {
    expect(defaultMetrics()).toBe(NO_METRICS);
    // The point of the identity check: `callAction` compares against
    // NO_METRICS to skip the timer entirely, so this must be the same object
    // and not merely an equivalent one.
    expect(() => {
      defaultMetrics().count("anything");
      defaultMetrics().observe("anything", 1);
    }).not.toThrow();
  });

  it("is replaced by the host's, and restored", () => {
    const spy = spyRecorder();
    setDefaultMetrics(spy);
    defaultMetrics().count(METRIC.actionsTotal, { action: "goals.read" });

    expect(spy.counts).toHaveLength(1);
    expect(spy.counts[0]?.name).toBe("openokr_actions_total");

    setDefaultMetrics(NO_METRICS);
    expect(defaultMetrics()).toBe(NO_METRICS);
  });
});

describe("the series names", () => {
  it("follow Prometheus convention, so a scraper reads them as intended", () => {
    // `_total` marks a counter and `_seconds` a duration. The exporter's
    // serializer renders a declared unit as its own metadata line and leaves
    // the name alone, so the suffix has to be in the name or it is nowhere.
    expect(METRIC.actionsTotal.endsWith("_total")).toBe(true);
    expect(METRIC.operationsTotal.endsWith("_total")).toBe(true);
    expect(METRIC.authorisationTotal.endsWith("_total")).toBe(true);
    expect(METRIC.actionDuration.endsWith("_seconds")).toBe(true);
    expect(METRIC.operationDuration.endsWith("_seconds")).toBe(true);
  });

  it("are all prefixed, so they cannot collide with a host's own series", () => {
    for (const name of Object.values(METRIC)) {
      expect(name.startsWith("openokr_")).toBe(true);
    }
  });
});

describe("the access level names", () => {
  it("cover every level the access model defines", () => {
    // Keyed off the numbers deliberately: a fifth level added to
    // ACCESS_LEVELS without a name here would render as a bare number on the
    // dashboard, which is exactly the lookup this map exists to remove.
    expect(ACCESS_LEVEL_NAMES[10]).toBe("view");
    expect(ACCESS_LEVEL_NAMES[40]).toBe("comment");
    expect(ACCESS_LEVEL_NAMES[70]).toBe("edit");
    expect(ACCESS_LEVEL_NAMES[100]).toBe("full");
    expect(Object.keys(ACCESS_LEVEL_NAMES)).toHaveLength(4);
  });
});

describe("the outcome labels", () => {
  it("keep refused and not-found apart", () => {
    // The product deliberately answers a caller the same way for both, so
    // that a refusal is not an oracle. The counter is the one place they are
    // distinguished, because it never leaves the instance and an operator
    // watching a spike needs to know which kind it is.
    expect(OUTCOME.refused).not.toBe(OUTCOME.notFound);
    expect(new Set(Object.values(OUTCOME)).size).toBe(4);
  });
});
