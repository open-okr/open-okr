import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The liveness check answers `ok` or `unavailable` and nothing else (H-B). The
 * scheduler and the tenant floor were in the body and are not: the route is
 * public, and `/admin/general` and `/api/status` carry them for whoever is
 * entitled.
 */

const query = vi.fn();

vi.mock("../lib/auth", () => ({ getPool: () => ({ query }) }));

const { GET } = await import("../app/api/health/route");

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
});

describe("GET /api/health", () => {
  it("answers only the status while the database answers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 when the database does not", async () => {
    query.mockRejectedValue(new Error("connection refused"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
