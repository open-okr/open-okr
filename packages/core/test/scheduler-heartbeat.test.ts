import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  readSchedulerHeartbeat,
  recordSchedulerHeartbeat,
} from "../src/status/scheduler-heartbeat.ts";

// Plan 0.8.0 H12: the stamp every pod's /api/status reads, written by the pod
// that completed a run.

const ring = parseKeyRing({ current: newRootKey() });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the scheduler's shared heartbeat", () => {
  it("is empty until a run is recorded", async () => {
    const wb = await workerDb();
    expect(await readSchedulerHeartbeat(wb.appPool)).toBeNull();
  });

  it("reads back, from the application's own role, what a run wrote", async () => {
    const wb = await workerDb();
    const at = new Date("2026-11-10T12:00:00.000Z");
    await recordSchedulerHeartbeat(wb.appPool, ring, at);
    expect(await readSchedulerHeartbeat(wb.appPool)).toBe(at.getTime());
  });

  it("keeps only the latest run", async () => {
    const wb = await workerDb();
    await recordSchedulerHeartbeat(
      wb.appPool,
      ring,
      new Date("2026-11-10T12:00:00.000Z"),
    );
    const later = new Date("2026-11-10T12:05:00.000Z");
    await recordSchedulerHeartbeat(wb.appPool, ring, later);
    expect(await readSchedulerHeartbeat(wb.appPool)).toBe(later.getTime());
    const rows = await wb.admin.query(
      "select source from system_settings where key = 'scheduler.last_run_at'",
    );
    expect(rows.rows).toEqual([{ source: "scheduler" }]);
  });
});
