import { canonThresholds, keyResultProgress } from "@openokr/method";
import { describe, expect, it } from "vitest";
import { dependencyDelivery } from "../src/alignment/delivery.ts";

/**
 * Whether a dependency's providing key result has delivered (design
 * `key-result-dependencies.md` K6 and K7, plan 0.7.0 O5).
 *
 * Pure, so no database. The progress each case feeds in is the one the method
 * computes for that kind of key result, because "delivered" is defined as the
 * key result reading 100%, and §2.10 decides what 100% means for each kind.
 */

const thresholds = canonThresholds();

const facts = (progressPct: number, extra: object = {}) => ({
  visible: true,
  progressPct,
  deleted: false,
  goalClosed: false,
  ...extra,
});

describe("dependencyDelivery", () => {
  it("is none when no key result is named", () => {
    expect(dependencyDelivery(null)).toBeNull();
  });

  it("reads a milestone pending until done, then delivered", () => {
    const before = keyResultProgress(
      {
        kind: "milestone",
        done: false,
        direction: "increase",
        baseline: 0,
        target: 1,
        current: 0,
      },
      thresholds,
    );
    const after = keyResultProgress(
      {
        kind: "milestone",
        done: true,
        direction: "increase",
        baseline: 0,
        target: 1,
        current: 0,
      },
      thresholds,
    );
    expect(dependencyDelivery(facts(before))).toBe("pending");
    expect(dependencyDelivery(facts(after))).toBe("delivered");
  });

  it("reads a baseline delivered once it is recorded", () => {
    const recorded = keyResultProgress(
      {
        kind: "baseline",
        done: true,
        direction: "increase",
        baseline: 0,
        target: 1,
        current: 0,
      },
      thresholds,
    );
    expect(dependencyDelivery(facts(recorded))).toBe("delivered");
  });

  it("reads a metric pending on the way and delivered at its target", () => {
    const halfway = keyResultProgress(
      {
        kind: "metric",
        direction: "increase",
        baseline: 0,
        target: 10,
        current: 5,
      },
      thresholds,
    );
    const there = keyResultProgress(
      {
        kind: "metric",
        direction: "increase",
        baseline: 0,
        target: 10,
        current: 10,
      },
      thresholds,
    );
    expect(dependencyDelivery(facts(halfway))).toBe("pending");
    expect(dependencyDelivery(facts(there))).toBe("delivered");
  });

  it("reads a maintain delivered inside its band, and pending again once a reading leaves it", () => {
    const inside = keyResultProgress(
      {
        kind: "maintain",
        direction: "maintain",
        baseline: 95,
        target: 99,
        current: 97,
      },
      thresholds,
    );
    const outside = keyResultProgress(
      {
        kind: "maintain",
        direction: "maintain",
        baseline: 95,
        target: 99,
        current: 92,
      },
      thresholds,
    );
    expect(dependencyDelivery(facts(inside))).toBe("delivered");
    expect(dependencyDelivery(facts(outside))).toBe("pending");
  });

  it("reads stopped when the key result is deleted, even at 100%", () => {
    expect(dependencyDelivery(facts(100, { deleted: true }))).toBe("stopped");
    expect(dependencyDelivery(facts(40, { deleted: true }))).toBe("stopped");
  });

  it("reads stopped when its goal closed below 100%, and delivered when it closed there", () => {
    expect(dependencyDelivery(facts(60, { goalClosed: true }))).toBe("stopped");
    expect(dependencyDelivery(facts(100, { goalClosed: true }))).toBe(
      "delivered",
    );
  });

  it("reads hidden for a reader who cannot view the providing goal, whatever the rest says", () => {
    for (const extra of [{}, { deleted: true }, { goalClosed: true }]) {
      expect(dependencyDelivery(facts(100, { ...extra, visible: false }))).toBe(
        "hidden",
      );
    }
  });
});
