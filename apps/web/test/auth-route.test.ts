import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lockout audit wrapper around Better Auth's handler (P1/P2-hardening,
 * TECHNICAL-PLAN §8.2).
 *
 * Better Auth's own rate limiter rejects a request from inside its router,
 * before any extension point (`onAPIError`, `onResponse`, a plugin hook)
 * ever sees it, so this route is the only place that can observe a 429 it
 * produced and record it. Mocked here rather than exercised through a real
 * handler: the point under test is "a 429 gets an audit row, everything
 * else does not," not Better Auth's own rate-limiting logic, which
 * `packages/core/test/auth.test.ts` already covers against a real database.
 */

const handlerMock = vi.fn();
const recordInstanceAuditEventMock = vi.fn();

vi.mock("../lib/auth", () => ({
  getAuth: () => ({ handler: handlerMock }),
  getPool: () => "fake-pool",
}));

vi.mock("@openokr/core", () => ({
  recordInstanceAuditEvent: recordInstanceAuditEventMock,
}));

beforeEach(() => {
  handlerMock.mockReset();
  recordInstanceAuditEventMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetModules();
});

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { headers });

describe("the auth route's lockout audit wrapper", () => {
  it("records an audit event when Better Auth's rate limiter refuses", async () => {
    handlerMock.mockResolvedValue(new Response(null, { status: 429 }));
    const { POST } = await import("../app/api/auth/[...all]/route");

    const response = await POST(
      request("/api/auth/sign-in/email", { "x-forwarded-for": "203.0.113.9" }),
    );

    expect(response.status).toBe(429);
    expect(recordInstanceAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordInstanceAuditEventMock).toHaveBeenCalledWith(
      "fake-pool",
      expect.objectContaining({
        action: "auth.rate_limited",
        payload: expect.objectContaining({
          path: "/api/auth/sign-in/email",
          address: "203.0.113.9",
        }),
      }),
    );
  });

  it("never records an audit event for an ordinary response", async () => {
    handlerMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await import("../app/api/auth/[...all]/route");

    await POST(request("/api/auth/sign-in/email"));

    expect(recordInstanceAuditEventMock).not.toHaveBeenCalled();
  });

  it("still returns the 429 even when the audit write itself fails", async () => {
    handlerMock.mockResolvedValue(new Response(null, { status: 429 }));
    recordInstanceAuditEventMock.mockRejectedValue(new Error("db is down"));
    const { POST } = await import("../app/api/auth/[...all]/route");

    const response = await POST(request("/api/auth/sign-in/email"));

    expect(response.status).toBe(429);
  });

  it("falls back to x-real-ip, then to a placeholder, when no forwarded header is present", async () => {
    handlerMock.mockResolvedValue(new Response(null, { status: 429 }));
    const { POST } = await import("../app/api/auth/[...all]/route");

    await POST(
      request("/api/auth/sign-in/email", { "x-real-ip": "198.51.100.1" }),
    );
    expect(recordInstanceAuditEventMock).toHaveBeenLastCalledWith(
      "fake-pool",
      expect.objectContaining({
        payload: expect.objectContaining({ address: "198.51.100.1" }),
      }),
    );

    await POST(request("/api/auth/sign-in/email"));
    expect(recordInstanceAuditEventMock).toHaveBeenLastCalledWith(
      "fake-pool",
      expect.objectContaining({
        payload: expect.objectContaining({ address: "unknown" }),
      }),
    );
  });
});
