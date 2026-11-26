import { OperationError } from "@openokr/core";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Starting a FlowyTeam connection (flowyteam-connect §3, card C5).
 *
 * The Import page is served with `form-action 'self'`, so the card cannot let
 * a form post be redirected to FlowyTeam. It asks with `Accept:
 * application/json` and moves the page itself. This proves that branch: the
 * address and the state cookie come back in one answer, a refusal comes back
 * as the Import page's own address, and a cross-site request is still refused
 * before anything else.
 */

const callAction = vi.fn();
vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("../lib/pool", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));
vi.mock("../lib/issuer", () => ({
  instanceIssuer: () => "https://okr.example",
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1" },
  }),
}));
vi.mock("../lib/flowyteam", () => ({
  FLOWYTEAM_STATE_COOKIE: "openokr_flowyteam_connect",
  instanceOrigin: () => "https://okr.example",
  importsPath: (outcome: string) => `/admin/imports?flowyteam=${outcome}`,
  outcomeOf: (error: unknown) =>
    error instanceof OperationError
      ? String(error.details?.reason ?? error.code)
      : "error",
  stateCookieOptions: () => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true,
    path: "/admin/imports/flowyteam",
    maxAge: 600,
  }),
}));

const { POST } = await import(
  "../app/admin/imports/flowyteam/connect/route.ts"
);

const AUTHORIZE = "https://flowyteam.com/oauth/authorize?state=abc";

function request(headers: Record<string, string>): Request {
  return new Request("https://okr.example/admin/imports/flowyteam/connect", {
    method: "POST",
    headers: { origin: "https://okr.example", ...headers },
  });
}

afterEach(() => {
  callAction.mockReset();
});

describe("the connect route", () => {
  it("answers the card with the address and sets the state cookie", async () => {
    callAction.mockResolvedValue({
      authorizeUrl: AUTHORIZE,
      stateCookie: "sealed-state",
    });
    const response = await POST(request({ accept: "application/json" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: AUTHORIZE });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("openokr_flowyteam_connect=sealed-state");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain("Path=/admin/imports/flowyteam");
  });

  it("still redirects a plain form post", async () => {
    callAction.mockResolvedValue({
      authorizeUrl: AUTHORIZE,
      stateCookie: "sealed-state",
    });
    const response = await POST(request({}));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(AUTHORIZE);
  });

  it("answers a refusal with the Import page and its reason word", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "Turned off.", {
        reason: "not_configured",
      }),
    );
    const response = await POST(request({ accept: "application/json" }));
    expect(await response.json()).toEqual({
      url: "https://okr.example/admin/imports?flowyteam=not_configured",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses another site before anything else", async () => {
    const response = await POST(
      request({ origin: "https://evil.example", accept: "application/json" }),
    );
    expect(response.status).toBe(403);
    expect(callAction).not.toHaveBeenCalled();
  });
});
