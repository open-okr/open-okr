import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The liveness check says what a green probe used to hide (completeness
 * review H-01, H-02): whether the scheduler started, and whether the database
 * enforces the tenant floor for this instance's role.
 */

const query = vi.fn();
const state = vi.fn();
const floor = vi.fn();

vi.mock("../lib/auth", () => ({ getPool: () => ({ query }) }));
vi.mock("../lib/scheduler", () => ({ schedulerState: () => state() }));
vi.mock("../lib/tenant-floor", () => ({ tenantFloor: () => floor() }));

const { GET } = await import("../app/api/health/route");

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  state.mockReset().mockReturnValue("running");
  floor.mockReset().mockResolvedValue("enforced");
});

describe("GET /api/health", () => {
  it("reports a running scheduler and an enforced floor", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      scheduler: "running",
      tenantFloor: "enforced",
    });
  });

  it("says so when the scheduler failed, and still answers 200", async () => {
    // A probe that failed here would restart a serving instance for something
    // a restart does not fix; the finding is in the body and on /admin.
    state.mockReturnValue("failed");
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).scheduler).toBe("failed");
  });

  it("says so when the role bypasses row-level security", async () => {
    floor.mockResolvedValue("bypassed");
    const response = await GET();
    expect((await response.json()).tenantFloor).toBe("bypassed");
  });

  it("answers 503 when the database does not", async () => {
    query.mockRejectedValue(new Error("connection refused"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
