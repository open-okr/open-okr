import { describe, expect, it } from "vitest";

import {
  type Admission,
  type AdmissionCounters,
  admit,
  currentConcurrentActions,
} from "../src/tenancy/admission.ts";

/**
 * Process-local concurrent-actions counter (P8-T06c).
 *
 * The counter is separate from the per-workspace cache counters that enforce
 * the concurrency limit. This one tracks how many actions the whole process
 * is running, for the `openokr_concurrent_actions` gauge on the capacity
 * dashboard.
 */

function makeCounters(): AdmissionCounters {
  let value = 0;
  return {
    async rateLimit() {
      return { allowed: true, resetSeconds: 0 };
    },
    async incr(_key: string, by = 1) {
      value += by;
      return value;
    },
  };
}

const admission = (
  limits: { actionsPerMinute: number; concurrentActions: number },
  c: AdmissionCounters,
): Admission => ({ ...limits, counters: c });

describe("concurrent actions gauge", () => {
  it("increments on admit and decrements on release, unlimited path", async () => {
    const before = currentConcurrentActions();
    const release = await admit(
      admission({ actionsPerMinute: 0, concurrentActions: 0 }, makeCounters()),
      "ws-1",
    );
    expect(currentConcurrentActions()).toBe(before + 1);
    await release();
    expect(currentConcurrentActions()).toBe(before);
  });

  it("increments on admit and decrements on release, limited path", async () => {
    const before = currentConcurrentActions();
    const release = await admit(
      admission(
        { actionsPerMinute: 120, concurrentActions: 10 },
        makeCounters(),
      ),
      "ws-2",
    );
    expect(currentConcurrentActions()).toBe(before + 1);
    await release();
    expect(currentConcurrentActions()).toBe(before);
  });

  it("increments on admit and decrements on release, rate-only path", async () => {
    const before = currentConcurrentActions();
    const release = await admit(
      admission(
        { actionsPerMinute: 120, concurrentActions: 0 },
        makeCounters(),
      ),
      "ws-3",
    );
    expect(currentConcurrentActions()).toBe(before + 1);
    await release();
    expect(currentConcurrentActions()).toBe(before);
  });

  it("does not increment when a rate refusal fires", async () => {
    const before = currentConcurrentActions();
    const refused: AdmissionCounters = {
      async rateLimit() {
        return { allowed: false, resetSeconds: 42 };
      },
      async incr(_key: string, by = 1) {
        return by;
      },
    };
    await expect(
      admit(
        admission({ actionsPerMinute: 60, concurrentActions: 0 }, refused),
        "ws-4",
      ),
    ).rejects.toThrow();
    expect(currentConcurrentActions()).toBe(before);
  });

  it("does not increment when a concurrency refusal fires", async () => {
    const before = currentConcurrentActions();
    // Start at the limit already
    let value = 5;
    const full: AdmissionCounters = {
      async rateLimit() {
        return { allowed: true, resetSeconds: 0 };
      },
      async incr(_key: string, by = 1) {
        value += by;
        return value;
      },
    };
    await expect(
      admit(
        admission({ actionsPerMinute: 0, concurrentActions: 5 }, full),
        "ws-5",
      ),
    ).rejects.toThrow();
    expect(currentConcurrentActions()).toBe(before);
  });

  it("calls onRefusal with 'rate' on a rate-limit refusal", async () => {
    const reasons: string[] = [];
    const refused: AdmissionCounters = {
      async rateLimit() {
        return { allowed: false, resetSeconds: 10 };
      },
      async incr(_key: string, by = 1) {
        return by;
      },
    };
    await expect(
      admit(
        admission({ actionsPerMinute: 60, concurrentActions: 0 }, refused),
        "ws-6",
        (reason) => reasons.push(reason),
      ),
    ).rejects.toThrow();
    expect(reasons).toEqual(["rate"]);
  });

  it("calls onRefusal with 'concurrency' on a concurrency refusal", async () => {
    const reasons: string[] = [];
    let value = 5;
    const full: AdmissionCounters = {
      async rateLimit() {
        return { allowed: true, resetSeconds: 0 };
      },
      async incr(_key: string, by = 1) {
        value += by;
        return value;
      },
    };
    await expect(
      admit(
        admission({ actionsPerMinute: 0, concurrentActions: 5 }, full),
        "ws-7",
        (reason) => reasons.push(reason),
      ),
    ).rejects.toThrow();
    expect(reasons).toEqual(["concurrency"]);
  });
});
