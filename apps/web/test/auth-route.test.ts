import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lockout audit wrapper around Better Auth's handler (P1/P2-hardening,
 * TECHNICAL-PLAN §8.2, account-lockout.md D13).
 *
 * Better Auth's own rate limiter rejects a request from inside its router,
 * before any extension point (`onAPIError`, `onResponse`, a plugin hook)
 * ever sees it, so this route is the only place that can observe a 429 it
 * produced and record it. Mocked here rather than exercised through a real
 * handler: the point under test is "the limiter's 429 gets an audit row,
 * everything else does not," not Better Auth's own rate-limiting logic, which
 * `packages/core/test/auth.test.ts` already covers against a real database.
 *
 * **Only the limiter's 429.** A sign-in hold answers 429 too, from a hook, and
 * is audited there once per hold rather than here once per refusal. The
 * limiter's answer is the only one carrying `X-Retry-After`.
 */

const handlerMock = vi.fn();
const recordInstanceAuditEventMock = vi.fn();

// The route asks for the current instance, which is the one rebuilt after an
// SSO change (completeness review L-15).
vi.mock("../lib/auth", () => ({
  getCurrentAuth: async () => ({ handler: handlerMock }),
  getPool: () => "fake-pool",
}));

vi.mock("@openokr/core", async () => {
  const { callerAddress, createAuth } =
    await vi.importActual<typeof import("@openokr/core")>("@openokr/core");
  return {
    callerAddress,
    createAuth,
    recordInstanceAuditEvent: recordInstanceAuditEventMock,
  };
});

beforeEach(() => {
  handlerMock.mockReset();
  recordInstanceAuditEventMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { headers });

/** What Better Auth's limiter answers. */
const limited = () =>
  new Response(null, { status: 429, headers: { "X-Retry-After": "42" } });

describe("the auth route's lockout audit wrapper", () => {
  it("records an audit event when Better Auth's rate limiter refuses", async () => {
    handlerMock.mockResolvedValue(limited());
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

  it("records the limiter's refusal of a new confirmation link too (email-verification.md D10)", async () => {
    handlerMock.mockResolvedValue(limited());
    const { POST } = await import("../app/api/auth/[...all]/route");

    await POST(
      request("/api/auth/send-verification-email", {
        "x-forwarded-for": "203.0.113.9",
      }),
    );

    expect(recordInstanceAuditEventMock).toHaveBeenCalledWith(
      "fake-pool",
      expect.objectContaining({
        action: "auth.rate_limited",
        payload: expect.objectContaining({
          path: "/api/auth/send-verification-email",
        }),
      }),
    );
  });

  it("records nothing for one address's allowance, which is counted, not audited (D17)", async () => {
    handlerMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "VERIFICATION_RESEND_HELD" }), {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    const { POST } = await import("../app/api/auth/[...all]/route");

    const response = await POST(request("/api/auth/send-verification-email"));

    expect(response.status).toBe(429);
    expect(recordInstanceAuditEventMock).not.toHaveBeenCalled();
  });

  it("records nothing for a sign-in hold, which its own hook audits", async () => {
    handlerMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "SIGN_IN_HELD" }), {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    const { POST } = await import("../app/api/auth/[...all]/route");

    const response = await POST(request("/api/auth/sign-in/email"));

    expect(response.status).toBe(429);
    expect(recordInstanceAuditEventMock).not.toHaveBeenCalled();
  });

  it("never records an audit event for an ordinary response", async () => {
    handlerMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { POST } = await import("../app/api/auth/[...all]/route");

    await POST(request("/api/auth/sign-in/email"));

    expect(recordInstanceAuditEventMock).not.toHaveBeenCalled();
  });

  it("still returns the 429 even when the audit write itself fails", async () => {
    handlerMock.mockResolvedValue(limited());
    recordInstanceAuditEventMock.mockRejectedValue(new Error("db is down"));
    const { POST } = await import("../app/api/auth/[...all]/route");

    const response = await POST(request("/api/auth/sign-in/email"));

    expect(response.status).toBe(429);
  });

  it("reads the address the way the limiter counted it, never the first of a chain", async () => {
    handlerMock.mockImplementation(async () => limited());
    const { POST } = await import("../app/api/auth/[...all]/route");

    // A chain's first entry is whatever the caller chose to send, so it is not
    // what the row records. With the default of one proxy (the hop count,
    // combined with trusted-proxies.md by Akmal on 11 November 2026), the
    // rightmost entry, which that proxy wrote, is.
    await POST(
      request("/api/auth/sign-in/email", {
        "x-forwarded-for": "6.6.6.6, 203.0.113.50",
      }),
    );
    const last = recordInstanceAuditEventMock.mock.lastCall?.[1] as {
      payload: { address: string };
    };
    expect(last.payload.address).not.toBe("6.6.6.6");
    expect(last.payload.address).toBe("203.0.113.50");
  });

  it("records the caller behind the proxies the deployment names (trusted-proxies.md D9)", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXIES", "10.0.1.0/24");
    handlerMock.mockImplementation(async () => limited());
    const { POST } = await import("../app/api/auth/[...all]/route");

    await POST(
      request("/api/auth/sign-in/email", {
        "x-forwarded-for": "203.0.113.66, 198.51.100.7, 10.0.1.9",
      }),
    );
    expect(recordInstanceAuditEventMock).toHaveBeenLastCalledWith(
      "fake-pool",
      expect.objectContaining({
        payload: expect.objectContaining({ address: "198.51.100.7" }),
      }),
    );
  });
});

/**
 * The endpoints no screen uses, through the route with a real instance
 * (account-self-service.md D26, plan 0.8.0 Y6). Better Auth refuses an off
 * path before the limiter and before reading anything, so the instance needs
 * no database to answer, and a stand-in pool proves it never asked.
 */
describe("a path that is off, through the route", () => {
  const realHandler = async () => {
    const { createAuth } = await import("@openokr/core");
    const auth = createAuth({
      pool: {} as never,
      secret: "a-test-secret-of-sufficient-length-for-signing",
      baseUrl: "http://localhost:3000",
    });
    handlerMock.mockImplementation((incoming: Request) =>
      auth.handler(incoming),
    );
  };

  it.each([
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/change-email"],
    ["POST", "/api/auth/verify-password"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/get-access-token"],
    ["POST", "/api/auth/sso/register"],
    ["POST", "/api/auth/update-user/"],
  ])("%s %s answers 404 and writes no audit row", async (method, path) => {
    await realHandler();
    const route = await import("../app/api/auth/[...all]/route");

    const response = await route[method as "GET" | "POST"](
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=anything",
        },
        ...(method === "POST" ? { body: JSON.stringify({ name: "X" }) } : {}),
      }),
    );

    expect(response.status).toBe(404);
    expect(recordInstanceAuditEventMock).not.toHaveBeenCalled();
  });
});
