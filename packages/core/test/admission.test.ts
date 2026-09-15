import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { callAction } from "../src/actions/registry.ts";
import { errorFor } from "../src/api/errors.ts";
import {
  type Admission,
  type AdmissionCounters,
  AdmissionError,
  AdmissionSettingError,
  admit,
  MIN_ACTIONS_PER_MINUTE,
  MIN_CONCURRENT_ACTIONS,
  validateAdmissionLimits,
} from "../src/tenancy/admission.ts";

/**
 * Per-tenant admission (P8-T06a).
 *
 * Design: `docs/design/p8-t01a-tenant-limits.md`, whose §8 is the test plan
 * this file implements. Criteria 2, 3, 5 and 6 are here. Criterion 1 needs
 * two tenants and a load run and belongs to `pnpm perf:load`; criteria 4 and
 * 7 are the relay's and are P8-T06b's.
 *
 * **No database anywhere in this file, and that is the point of criterion
 * 2.** A refused call must not reach the pool, so the pool these tests pass
 * throws if anything touches it. A test that used a real one could not tell
 * a refusal that took a connection from a refusal that did not.
 */

/** A pool that fails the test if an action ever reaches it. */
const FORBIDDEN_POOL = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(
        `The pool was touched (.${String(property)}). A refused call must ` +
          `not take a connection: that is the whole point of admitting ` +
          `before the handler runs.`,
      );
    },
  },
) as unknown as Pool;

/** A counters double that records what admission asked it. */
function counters(options: {
  readonly allowed?: boolean;
  readonly resetSeconds?: number;
  readonly concurrentInUse?: number;
}): AdmissionCounters & { readonly calls: string[]; value: number } {
  const calls: string[] = [];
  const state = {
    calls,
    value: options.concurrentInUse ?? 0,
    async rateLimit(key: string, limit: number, windowSeconds: number) {
      calls.push(`rateLimit ${key} ${limit} ${windowSeconds}`);
      return {
        allowed: options.allowed ?? true,
        resetSeconds: options.resetSeconds ?? 0,
      };
    },
    async incr(key: string, by = 1) {
      calls.push(`incr ${key} ${by}`);
      state.value += by;
      return state.value;
    },
  };
  return state;
}

const admission = (
  limits: { actionsPerMinute: number; concurrentActions: number },
  c: AdmissionCounters,
): Admission => ({ ...limits, counters: c });

describe("unlimited is the default, and it costs nothing", () => {
  it("makes no round trip at all when both limits are zero", async () => {
    // §8 criterion 5, and §7: a self-hosted instance meets two comparisons
    // against zero. If this ever starts calling the cache, every self-hosted
    // instance pays for a limit it does not have.
    const c = counters({});
    const release = await admit(
      admission({ actionsPerMinute: 0, concurrentActions: 0 }, c),
      "workspace-1",
    );
    await release();

    expect(c.calls).toEqual([]);
  });

  it("skips the concurrency counter when only the rate limit is set", async () => {
    const c = counters({});
    await admit(
      admission({ actionsPerMinute: 600, concurrentActions: 0 }, c),
      "workspace-1",
    );

    expect(c.calls).toEqual(["rateLimit admission:rate:workspace-1 600 60"]);
  });
});

describe("the per-minute window", () => {
  it("refuses with the reset time when the window is full", async () => {
    // §8 criterion 6. A refusal that does not say when is a refusal that
    // gets retried in a loop, which turns one limited tenant into a limited
    // instance.
    const c = counters({ allowed: false, resetSeconds: 17 });

    await expect(
      admit(
        admission({ actionsPerMinute: 600, concurrentActions: 0 }, c),
        "workspace-1",
      ),
    ).rejects.toBeInstanceOf(AdmissionError);

    try {
      await admit(
        admission({ actionsPerMinute: 600, concurrentActions: 0 }, c),
        "workspace-1",
      );
      expect.unreachable("admission should have refused");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AdmissionError);
      expect((thrown as AdmissionError).resetSeconds).toBe(17);
      expect((thrown as AdmissionError).message).toContain("17");
    }
  });

  it("keys the window on the workspace, so one tenant cannot spend another's", async () => {
    const c = counters({});
    await admit(
      admission({ actionsPerMinute: 600, concurrentActions: 0 }, c),
      "workspace-a",
    );
    await admit(
      admission({ actionsPerMinute: 600, concurrentActions: 0 }, c),
      "workspace-b",
    );

    expect(c.calls).toEqual([
      "rateLimit admission:rate:workspace-a 600 60",
      "rateLimit admission:rate:workspace-b 600 60",
    ]);
  });
});

describe("the concurrency counter", () => {
  it("takes a slot and gives it back", async () => {
    const c = counters({});
    const release = await admit(
      admission({ actionsPerMinute: 0, concurrentActions: 4 }, c),
      "workspace-1",
    );
    expect(c.value).toBe(1);

    await release();
    expect(c.value).toBe(0);
  });

  it("refuses past the limit, and gives the slot straight back", async () => {
    // Holding the slot it just refused would mean one refusal made the next
    // one more likely, which is how a limiter turns a burst into a wedged
    // tenant that never recovers.
    const c = counters({ concurrentInUse: 4 });

    await expect(
      admit(
        admission({ actionsPerMinute: 0, concurrentActions: 4 }, c),
        "workspace-1",
      ),
    ).rejects.toBeInstanceOf(AdmissionError);

    expect(c.value).toBe(4);
    expect(c.calls).toEqual([
      "incr admission:concurrent:workspace-1 1",
      "incr admission:concurrent:workspace-1 -1",
    ]);
  });

  it("releases once however many times it is called", async () => {
    // `callAction` releases in a `finally`. A caller that also released by
    // hand would take the count negative, which reads as free capacity that
    // does not exist.
    const c = counters({});
    const release = await admit(
      admission({ actionsPerMinute: 0, concurrentActions: 4 }, c),
      "workspace-1",
    );

    await release();
    await release();
    await release();

    expect(c.value).toBe(0);
  });
});

describe("the floors, so a number nobody thought about cannot stop the product", () => {
  it("accepts zero, which is unlimited", () => {
    expect(() =>
      validateAdmissionLimits({ actionsPerMinute: 0, concurrentActions: 0 }),
    ).not.toThrow();
  });

  it("refuses a rate below the floor and says what to use instead", () => {
    try {
      validateAdmissionLimits({ actionsPerMinute: 1, concurrentActions: 0 });
      expect.unreachable("a rate of 1 should be refused");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AdmissionSettingError);
      expect((thrown as Error).message).toContain(
        String(MIN_ACTIONS_PER_MINUTE),
      );
      expect((thrown as Error).message).toContain("0 for unlimited");
    }
  });

  it("refuses a concurrency of one, which serialises a whole tenant", () => {
    expect(() =>
      validateAdmissionLimits({ actionsPerMinute: 0, concurrentActions: 1 }),
    ).toThrow(AdmissionSettingError);
    expect(() =>
      validateAdmissionLimits({
        actionsPerMinute: 0,
        concurrentActions: MIN_CONCURRENT_ACTIONS,
      }),
    ).not.toThrow();
  });

  it("refuses a fraction and a negative, which are neither a limit nor unlimited", () => {
    expect(() =>
      validateAdmissionLimits({ actionsPerMinute: 60.5, concurrentActions: 0 }),
    ).toThrow(AdmissionSettingError);
    expect(() =>
      validateAdmissionLimits({ actionsPerMinute: -1, concurrentActions: 0 }),
    ).toThrow(AdmissionSettingError);
  });
});

describe("through callAction, which is the door this protects", () => {
  it("refuses before the handler and before the pool", async () => {
    // **§8 criterion 2.** The pool throws on any property access, so this
    // passes only if nothing reached it. An action that had started would
    // have taken a connection for the length of its query, which is the
    // resource one tenant takes from another.
    const c = counters({ allowed: false, resetSeconds: 9 });

    await expect(
      callAction(
        {
          pool: FORBIDDEN_POOL,
          workspaceId: "workspace-1",
          actor: {
            kind: "human",
            userId: "00000000-0000-4000-8000-000000000001",
          },
          admission: admission(
            { actionsPerMinute: 600, concurrentActions: 0 },
            c,
          ),
        },
        "workspace.overview",
        {},
      ),
    ).rejects.toBeInstanceOf(AdmissionError);
  });

  it("turns the refusal into a 429 that carries the retry time", async () => {
    // §8 criterion 6, at the surface. `statusFor("rate_limited")` is already
    // 429; what is new is that the seconds travel with it, so REST and the
    // command line can set `Retry-After` and an agent can wait rather than
    // retry in a loop.
    const error = errorFor(new AdmissionError("Over the limit.", 23));

    expect(error.code).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBe(23);
  });
});
