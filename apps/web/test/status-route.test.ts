import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/status` and Admin General with the scheduler on the worker (plan
 * 0.8.0 H10d, docs/design/worker-deployment.md §1.3).
 *
 * A web pod with `OPENOKR_SCHEDULER=elsewhere` runs no scheduler, and used to
 * answer `operational` whatever happened, exactly as `off` does. It now judges
 * the stamp the worker writes, so a worker that stopped turns the status red
 * on every pod, and Admin General says to check the worker. `off` is
 * unchanged: an instance that runs its sweeps by hand is not reported down.
 */

const MINUTE = 60_000;
const heartbeat = vi.fn();
const state = vi.fn();

vi.mock("@openokr/core", () => ({
  readSchedulerHeartbeat: () => heartbeat(),
}));
vi.mock("@openokr/adapters", () => ({
  OutboxRelay: { oldestPendingSeconds: async () => 0 },
}));
vi.mock("../lib/pool", () => ({
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));
vi.mock("../lib/admission", () => ({ outboxRowsPerMinute: () => 0 }));
vi.mock("../lib/scheduler", () => ({
  schedulerState: () => state(),
  schedulerBootedAt: () => null,
  schedulerLastRunAt: () => null,
}));
vi.mock("../lib/status-thresholds", () => ({
  statusThresholds: () => ({
    relay: { degraded: 300, unavailable: 1800 },
    scheduler: { degraded: 7200, unavailable: 14400 },
  }),
}));

const { GET } = await import("../app/api/status/route");
const { schedulerNotice } = await import("../lib/scheduler-status");

const original = process.env.OPENOKR_SCHEDULER;

const withScheduler = (value: "on" | "off" | "elsewhere") => {
  process.env.OPENOKR_SCHEDULER = value;
  resetEnvCache();
  state.mockReturnValue(value === "on" ? "running" : value);
};

beforeEach(() => {
  process.env.DATABASE_URL ??=
    "postgres://openokr:secret@localhost:5432/openokr";
  heartbeat.mockReset();
  state.mockReset();
});

afterEach(() => {
  process.env.OPENOKR_SCHEDULER = original;
  resetEnvCache();
});

const scheduler = async () => {
  const response = await GET();
  const body = await response.json();
  return { code: response.status, status: body.components.scheduler.status };
};

describe("/api/status with the scheduler elsewhere", () => {
  it("is operational while the worker's stamp is fresh", async () => {
    withScheduler("elsewhere");
    heartbeat.mockResolvedValue(Date.now() - MINUTE);
    expect(await scheduler()).toEqual({ code: 200, status: "operational" });
  });

  it("is unavailable when the worker has not run for five hours", async () => {
    withScheduler("elsewhere");
    heartbeat.mockResolvedValue(Date.now() - 300 * MINUTE);
    expect(await scheduler()).toEqual({ code: 503, status: "unavailable" });
  });

  it("is unavailable when the stamp cannot be read", async () => {
    withScheduler("elsewhere");
    heartbeat.mockRejectedValue(new Error("connection refused"));
    expect((await scheduler()).status).toBe("unavailable");
  });

  it("gives a process with no stamp yet its grace from boot", async () => {
    withScheduler("elsewhere");
    heartbeat.mockResolvedValue(null);
    expect((await scheduler()).status).toBe("operational");
  });

  it("with the scheduler off, is operational whatever the stamp", async () => {
    withScheduler("off");
    heartbeat.mockResolvedValue(Date.now() - 300 * MINUTE);
    expect((await scheduler()).status).toBe("operational");
  });
});

describe("the scheduler notice Admin General shows", () => {
  it("names the worker when the scheduler runs elsewhere and is unavailable", async () => {
    withScheduler("elsewhere");
    heartbeat.mockResolvedValue(Date.now() - 300 * MINUTE);
    expect(await schedulerNotice()).toBe("elsewhere");
  });

  it("is not shown while the worker's scheduler is operational", async () => {
    withScheduler("elsewhere");
    heartbeat.mockResolvedValue(Date.now() - MINUTE);
    expect(await schedulerNotice()).toBeNull();
  });

  it("is not shown for a degraded worker, only an unavailable one", async () => {
    withScheduler("elsewhere");
    heartbeat.mockResolvedValue(Date.now() - 180 * MINUTE);
    expect(await schedulerNotice()).toBeNull();
  });

  it("says this pod's scheduler failed when it runs here and could not start", async () => {
    withScheduler("on");
    state.mockReturnValue("failed");
    expect(await schedulerNotice()).toBe("failed");
  });

  it("is never shown with the scheduler off", async () => {
    withScheduler("off");
    heartbeat.mockResolvedValue(Date.now() - 300 * MINUTE);
    expect(await schedulerNotice()).toBeNull();
  });
});
