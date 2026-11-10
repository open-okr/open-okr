import type { CallerAddressReading } from "@openokr/config";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recordCallerAddressReading } from "../src/auth/caller-address-audit.ts";

/**
 * When the reading of the caller's address changed, on the instance chain
 * (docs/design/trusted-proxies.md D11).
 *
 * The reading decides whether every per-address limit works, so "when did that
 * change" belongs on the chain. One row per change, not one per boot: the
 * newest row is compared under the chain's own lock, so replicas booting
 * together write one.
 */

const NOTHING: CallerAddressReading = { mode: "single_address" };
const RANGES: CallerAddressReading = {
  mode: "trusted_proxies",
  trustedProxies: ["10.0.2.0/24", "10.0.1.0/24"],
};

const rows = async () => {
  const wb = await workerDb();
  const { rows: found } = await wb.admin.query<{
    payload: Record<string, unknown>;
  }>(
    `select payload from instance_audit_events
      where action = 'instance.caller_address_configured' order by seq`,
  );
  return found.map((row) => row.payload);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the caller address reading on the instance chain", () => {
  it("records the starting point on the first boot", async () => {
    const wb = await workerDb();
    expect(await recordCallerAddressReading(wb.appPool, NOTHING)).toBe(
      "recorded",
    );
    expect(await rows()).toEqual([
      { mode: "single_address", trustedProxies: [], header: null },
    ]);
  });

  it("records nothing when the reading has not changed", async () => {
    const wb = await workerDb();
    await recordCallerAddressReading(wb.appPool, RANGES);
    expect(
      await recordCallerAddressReading(wb.appPool, {
        mode: "trusted_proxies",
        // The same ranges in another order are the same reading.
        trustedProxies: ["10.0.1.0/24", "10.0.2.0/24"],
      }),
    ).toBe("unchanged");
    expect(await rows()).toEqual([
      {
        mode: "trusted_proxies",
        trustedProxies: ["10.0.1.0/24", "10.0.2.0/24"],
        header: null,
      },
    ]);
  });

  it("records a change", async () => {
    const wb = await workerDb();
    await recordCallerAddressReading(wb.appPool, NOTHING);
    expect(
      await recordCallerAddressReading(wb.appPool, {
        mode: "header",
        header: "cf-connecting-ip",
      }),
    ).toBe("recorded");
    expect(await rows()).toEqual([
      { mode: "single_address", trustedProxies: [], header: null },
      { mode: "header", trustedProxies: [], header: "cf-connecting-ip" },
    ]);
  });

  it("records one row when two processes boot together with a changed reading", async () => {
    const wb = await workerDb();
    await recordCallerAddressReading(wb.appPool, NOTHING);
    const outcomes = await Promise.all([
      recordCallerAddressReading(wb.appPool, RANGES),
      recordCallerAddressReading(wb.appPool, RANGES),
      recordCallerAddressReading(wb.appPool, RANGES),
    ]);
    expect(outcomes.filter((outcome) => outcome === "recorded")).toHaveLength(
      1,
    );
    expect(await rows()).toHaveLength(2);
  });

  it("names no actor, because the deployment changed it", async () => {
    const wb = await workerDb();
    await recordCallerAddressReading(wb.appPool, NOTHING);
    const [payload] = await rows();
    expect(Object.keys(payload ?? {}).sort()).toEqual([
      "header",
      "mode",
      "trustedProxies",
    ]);
  });
});
