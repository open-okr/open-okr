import { describe, expect, it } from "vitest";
import {
  StatusSettingError,
  statusThresholdsFrom,
} from "../src/status/thresholds.ts";

/**
 * The four `/api/status` thresholds (docs/design/status-and-capacity.md §4,
 * plan 0.7.0 P8).
 *
 * Two things were missing. The route read only the environment, so the four
 * instance settings were declared and never read. And each threshold was
 * checked only to be a positive number, so an "unavailable" at or below its
 * "degraded" was accepted, and the component could never report degraded.
 */

const none = {};

describe("the status thresholds", () => {
  it("default to the design's numbers", () => {
    expect(statusThresholdsFrom(none, none)).toEqual({
      relay: { degraded: 300, unavailable: 1800 },
      scheduler: { degraded: 7200, unavailable: 14400 },
    });
  });

  it("take the environment where nothing is stored", () => {
    const resolved = statusThresholdsFrom(none, {
      OPENOKR_STATUS_RELAY_DEGRADED_SECONDS: "60",
      OPENOKR_STATUS_RELAY_UNAVAILABLE_SECONDS: "600",
    });
    expect(resolved.relay).toEqual({ degraded: 60, unavailable: 600 });
  });

  it("let a stored setting beat the environment, as every instance setting does", () => {
    const resolved = statusThresholdsFrom(
      { "status.schedulerDegradedSeconds": 3600 },
      { OPENOKR_STATUS_SCHEDULER_DEGRADED_SECONDS: "60" },
    );
    expect(resolved.scheduler.degraded).toBe(3600);
  });

  it("refuse an unavailable threshold at or below its degraded one, naming both", () => {
    const attempt = () =>
      statusThresholdsFrom(none, {
        OPENOKR_STATUS_RELAY_DEGRADED_SECONDS: "1800",
        OPENOKR_STATUS_RELAY_UNAVAILABLE_SECONDS: "1800",
      });
    expect(attempt).toThrow(StatusSettingError);
    expect(attempt).toThrow(/status\.relayUnavailableSeconds/);
    expect(attempt).toThrow(/status\.relayDegradedSeconds/);
  });

  it("refuse a threshold that is not a positive number", () => {
    expect(() =>
      statusThresholdsFrom({ "status.schedulerDegradedSeconds": 0 }, none),
    ).toThrow(/status\.schedulerDegradedSeconds/);
    expect(() =>
      statusThresholdsFrom({ "status.relayDegradedSeconds": "soon" }, none),
    ).toThrow(StatusSettingError);
  });
});
