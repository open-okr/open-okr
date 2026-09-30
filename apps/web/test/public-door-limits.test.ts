import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rate limits on the doors a program knocks on (completeness review M-12).
 *
 * | Door | Counted per | Refusal |
 * |---|---|---|
 * | `/api/mcp` | Grant, or agent token | 429, `Retry-After`, a JSON-RPC error answering the request's id |
 * | `/api/mcp/register` | Caller address | 429, `Retry-After`, an OAuth error |
 * | `/api/mcp/token` | Caller address | 429, `Retry-After`, an OAuth error, never cached |
 * | `/api/scim/v2/*` | Directory token | 429, `Retry-After`, the SCIM error schema |
 * | `/api/v1/*` | API token | 429, and now `Retry-After` too |
 *
 * The caller address is the one the sign-in lockout counts, from core's
 * `callerAddress`, which is left unmocked here so a route cannot quietly go
 * back to trusting the first entry of a forwarded chain.
 *
 * Mocked at the cache, because what is under test is what each route does with
 * a full window: the key it counts under, that nothing behind the limit runs,
 * and that the answer is in the protocol's own shape. The counter itself is the
 * cache driver's, tested against a real database in `packages/adapters`.
 *
 * The agent endpoint's second way in, an agent token, is here too: it gets no
 * session, and a REST token at this door is told which kind to mint. What a
 * token resolves to is proved against a real database in
 * `packages/core/test/mcp-principal.test.ts`.
 */

const ISSUER = "https://okr.example";

const rateLimit = vi.fn();
const pool = { fake: "pool" };

const resolveAgentPrincipal = vi.fn();
const recordSessionFor = vi.fn();
const sessionFor = vi.fn();
const stampSessionUse = vi.fn();
const registerClientForInstance = vi.fn();
const redeemCodeForTokens = vi.fn();
const resolveSCIMToken = vi.fn();
const listDirectoryUsers = vi.fn();
const resolveApiToken = vi.fn();
const startDeviceAuthorisation = vi.fn();
const handle = vi.fn();

vi.mock("../lib/cache", () => ({ getCache: () => ({ rateLimit }) }));
vi.mock("../lib/pool", () => ({ getPool: () => pool }));
vi.mock("../lib/auth", () => ({ getPool: () => pool, getAuth: () => ({}) }));
vi.mock("../lib/issuer", () => ({ instanceIssuer: () => ISSUER }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => undefined }));

vi.mock("@openokr/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/config")>()),
  loadEnv: () => ({ BETTER_AUTH_URL: ISSUER, NODE_ENV: "test" }),
}));

vi.mock("@openokr/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/adapters")>()),
  McpAgentServer: class {
    handle(request: Request) {
      return handle(request);
    }
  },
}));

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  resolveAgentPrincipal,
  recordSessionFor,
  sessionFor,
  stampSessionUse,
  registerClientForInstance,
  redeemCodeForTokens,
  resolveSCIMToken,
  listDirectoryUsers,
  resolveApiToken,
  startDeviceAuthorisation,
}));

const mcp = await import("../app/api/mcp/route");
const register = await import("../app/api/mcp/register/route");
const token = await import("../app/api/mcp/token/route");
const scimUsers = await import("../app/api/scim/v2/Users/route");
const rest = await import("../app/api/v1/[[...path]]/route");
const device = await import("../app/api/v1/cli/device/route");

const ALLOWED = { allowed: true, remaining: 599, resetSeconds: 60 };
const FULL = { allowed: false, remaining: 0, resetSeconds: 17 };

const GRANT = {
  kind: "ok",
  via: "grant",
  grantId: "grant-1",
  workspaceId: "ws-1",
  memberId: "member-1",
  userId: "user-1",
  scopes: ["read"],
} as const;

const AGENT_TOKEN = {
  kind: "ok",
  via: "token",
  tokenId: "token-1",
  workspaceId: "ws-1",
  memberId: "member-1",
  userId: "user-1",
  scopes: ["read"],
} as const;

beforeEach(() => {
  for (const mock of [
    rateLimit,
    resolveAgentPrincipal,
    recordSessionFor,
    sessionFor,
    stampSessionUse,
    registerClientForInstance,
    redeemCodeForTokens,
    resolveSCIMToken,
    listDirectoryUsers,
    resolveApiToken,
    startDeviceAuthorisation,
    handle,
  ]) {
    mock.mockReset();
  }
  rateLimit.mockResolvedValue(ALLOWED);
  handle.mockImplementation(
    async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 42, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

/** An agent's request, as a runtime sends it. */
const rpc = (
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  new Request(`${ISSUER}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      authorization: "Bearer okr_mcp_presented",
      ...headers,
    },
    body: JSON.stringify(body),
  }) as never;

const initialize = {
  jsonrpc: "2.0",
  id: 42,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "a coding agent", version: "1.0.0" },
  },
};

describe("the agent endpoint", () => {
  it("refuses a full window with a JSON-RPC error answering the request's id", async () => {
    resolveAgentPrincipal.mockResolvedValue(AGENT_TOKEN);
    rateLimit.mockResolvedValue(FULL);

    const response = await mcp.POST(
      rpc({ jsonrpc: "2.0", id: 42, method: "tools/list", params: {} }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 42,
      error: { code: -32000, data: { retryAfterSeconds: 17 } },
    });
    expect(body.error.message).toContain("600 requests a minute");
    // Nothing behind the limit ran.
    expect(handle).not.toHaveBeenCalled();
  });

  it("counts an agent token under the token, and a grant under the grant", async () => {
    resolveAgentPrincipal.mockResolvedValueOnce(AGENT_TOKEN);
    await mcp.POST(rpc(initialize));
    expect(rateLimit).toHaveBeenLastCalledWith("mcp:token:token-1", 600, 60);

    resolveAgentPrincipal.mockResolvedValueOnce(GRANT);
    await mcp.POST(rpc(initialize, { authorization: "Bearer okr_at_x" }));
    expect(rateLimit).toHaveBeenLastCalledWith("mcp:grant:grant-1", 600, 60);
  });

  it("counts nothing for a caller it could not identify", async () => {
    const response = await mcp.POST(rpc(initialize, { authorization: "" }));
    expect(response.status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("gives a grant a session, recorded against the grant", async () => {
    resolveAgentPrincipal.mockResolvedValue(GRANT);
    const response = await mcp.POST(
      rpc(initialize, { authorization: "Bearer okr_at_x" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    expect(recordSessionFor).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ grantId: "grant-1" }),
    );
  });

  it("serves an agent token without a session, which the protocol allows", async () => {
    resolveAgentPrincipal.mockResolvedValue(AGENT_TOKEN);
    const response = await mcp.POST(rpc(initialize));
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(recordSessionFor).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("refuses a session an agent token does not hold", async () => {
    resolveAgentPrincipal.mockResolvedValue(AGENT_TOKEN);
    const response = await mcp.POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { "mcp-session-id": "somebody-elses" },
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_session");
    expect(sessionFor).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it("tells the holder of a REST token which kind to mint", async () => {
    resolveAgentPrincipal.mockResolvedValue({
      kind: "rejected",
      reason: "wrong_audience",
    });
    const response = await mcp.POST(
      rpc(initialize, { authorization: "Bearer okr_rest_x" }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    expect((await response.json()).error_description).toContain("REST surface");
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("says nothing more than no to a token nobody issued", async () => {
    resolveAgentPrincipal.mockResolvedValue({
      kind: "rejected",
      reason: "invalid",
    });
    const response = await mcp.POST(rpc(initialize));
    expect(response.status).toBe(401);
    expect((await response.json()).error_description).toBe(
      "That token is not one this instance will accept.",
    );
  });
});

/** What the shipped proxy writes: the one address it saw. */
const from = (address: string) => ({ "x-forwarded-for": address });

describe("dynamic client registration", () => {
  const registration = (headers: Record<string, string> = {}) =>
    new Request(`${ISSUER}/api/mcp/register`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        client_name: "An agent",
        redirect_uris: ["http://127.0.0.1:7777/callback"],
      }),
    }) as never;

  it("refuses a full window per caller address, in OAuth's own shape", async () => {
    rateLimit.mockResolvedValue(FULL);
    const response = await register.POST(registration(from("203.0.113.9")));

    expect(rateLimit).toHaveBeenCalledWith(
      "oauth:register:203.0.113.9",
      10,
      60,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    // Readable by a browser-based client, which is why the header is exposed.
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "retry-after",
    );
    expect((await response.json()).error).toBe("temporarily_unavailable");
    expect(registerClientForInstance).not.toHaveBeenCalled();
  });

  it("registers as before while the window has room", async () => {
    registerClientForInstance.mockResolvedValue({
      kind: "refused",
      error: "invalid_redirect_uri",
      description: "No.",
    });
    const response = await register.POST(registration(from("203.0.113.9")));
    expect(registerClientForInstance).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
  });
});

describe("the token endpoint", () => {
  const redemption = (headers: Record<string, string> = {}) =>
    new Request(`${ISSUER}/api/mcp/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "okr_code_x",
        code_verifier: "v".repeat(64),
        redirect_uri: "http://127.0.0.1:7777/callback",
      }).toString(),
    }) as never;

  it("refuses a full window per caller address, and is never cached", async () => {
    rateLimit.mockResolvedValue(FULL);
    const response = await token.POST(redemption(from("198.51.100.4")));

    expect(rateLimit).toHaveBeenCalledWith("oauth:token:198.51.100.4", 600, 60);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error).toBe("temporarily_unavailable");
    expect(redeemCodeForTokens).not.toHaveBeenCalled();
  });

  it("redeems as before while the window has room", async () => {
    redeemCodeForTokens.mockResolvedValue({
      kind: "refused",
      error: "invalid_grant",
      description: "No.",
    });
    const response = await token.POST(redemption(from("198.51.100.4")));
    expect(redeemCodeForTokens).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
  });
});

describe("SCIM", () => {
  const list = (headers: Record<string, string> = {}) =>
    new Request(`${ISSUER}/api/scim/v2/Users`, {
      headers: { authorization: "Bearer scim-secret", ...headers },
    });

  it("refuses a full window per directory token, in SCIM's error schema", async () => {
    resolveSCIMToken.mockResolvedValue({
      workspaceId: "ws-1",
      tokenId: "scim-token-1",
    });
    rateLimit.mockResolvedValue(FULL);

    const response = await scimUsers.GET(list());

    expect(rateLimit).toHaveBeenCalledWith("scim:scim-token-1", 600, 60);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await response.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "429",
    });
    expect(listDirectoryUsers).not.toHaveBeenCalled();
  });

  it("answers as before while the window has room", async () => {
    resolveSCIMToken.mockResolvedValue({
      workspaceId: "ws-1",
      tokenId: "scim-token-1",
    });
    listDirectoryUsers.mockResolvedValue([]);
    const response = await scimUsers.GET(list());
    expect(response.status).toBe(200);
    expect(listDirectoryUsers).toHaveBeenCalledTimes(1);
  });

  it("counts nothing for a token it does not know", async () => {
    resolveSCIMToken.mockResolvedValue(null);
    const response = await scimUsers.GET(list());
    expect(response.status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("the REST surface and the device login", () => {
  it("says when to try again on the REST surface", async () => {
    resolveApiToken.mockResolvedValue({
      kind: "ok",
      tokenId: "rest-token-1",
      workspaceId: "ws-1",
      memberId: "member-1",
      userId: "user-1",
      scopes: ["read"],
    });
    rateLimit.mockResolvedValue(FULL);

    const response = await rest.GET(
      new Request(`${ISSUER}/api/v1/goals/list`, {
        headers: { authorization: "Bearer okr_rest_x" },
      }) as never,
      { params: Promise.resolve({ path: ["goals", "list"] }) },
    );

    expect(rateLimit).toHaveBeenCalledWith("api:rest-token-1", 600, 60);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect((await response.json()).error.code).toBe("rate_limited");
  });

  it("says when to try again on a device login", async () => {
    rateLimit.mockResolvedValue(FULL);
    const response = await device.POST(
      new Request(`${ISSUER}/api/v1/cli/device`, {
        method: "POST",
        headers: { "content-type": "application/json", ...from("192.0.2.7") },
        body: JSON.stringify({ scopes: ["read"] }),
      }) as never,
    );

    expect(rateLimit).toHaveBeenCalledWith("device:start:192.0.2.7", 10, 60);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(startDeviceAuthorisation).not.toHaveBeenCalled();
  });
});

describe("an address a caller wrote for itself", () => {
  it("is not what an unauthenticated door counts under", async () => {
    rateLimit.mockResolvedValue(FULL);
    const knock = (headers: Record<string, string>) =>
      register.POST(
        new Request(`${ISSUER}/api/mcp/register`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: "{}",
        }) as never,
      );

    // A chain is what a proxy that appends leaves behind, and its first entry
    // is whatever the caller sent. Counting under it would give a caller a
    // fresh window for every address it cared to invent.
    await knock({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    const spoofed = rateLimit.mock.lastCall?.[0] as string;
    expect(spoofed).not.toContain("203.0.113.9");

    await knock({});
    expect(rateLimit.mock.lastCall?.[0]).toBe(spoofed);
  });
});
