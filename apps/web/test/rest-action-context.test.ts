import { REST_ROUTES } from "@openokr/core";
import { beforeEach, expect, it, vi } from "vitest";

/**
 * What the REST surface hands an action, beside the input.
 *
 * An action that seals a credential needs the key ring, and one that names
 * the instance needs its address. The screens always passed both; this
 * surface, which the command line also uses, passed neither, so a new SSO
 * client secret or AI key sent over the API was refused.
 */

const ISSUER = "https://okr.example";
const RING = { sentinel: "the instance key ring" };
const pool = { fake: "pool" };

const callAction = vi.fn();
const validateAction = vi.fn();
const resolveApiToken = vi.fn();
const stampTokenUse = vi.fn();

vi.mock("../lib/cache", () => ({
  getCache: () => ({
    rateLimit: async () => ({ allowed: true, resetSeconds: 0 }),
  }),
}));
vi.mock("../lib/pool", () => ({ getPool: () => pool }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => RING }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OpenOKR",
}));
vi.mock("@openokr/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/config")>()),
  loadEnv: () => ({ BETTER_AUTH_URL: ISSUER, NODE_ENV: "test" }),
}));
vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
  validateAction: (...args: unknown[]) => validateAction(...args),
  resolveApiToken: (...args: unknown[]) => resolveApiToken(...args),
  stampTokenUse: (...args: unknown[]) => stampTokenUse(...args),
}));

const rest = await import("../app/api/v1/[[...path]]/route");

beforeEach(() => {
  callAction.mockReset().mockResolvedValue({ id: "done" });
  validateAction.mockReset().mockResolvedValue({
    input: { title: "Checked" },
    result: { id: "would-be" },
  });
  resolveApiToken.mockReset().mockResolvedValue({
    kind: "accepted",
    tokenId: "token-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    scopes: ["read", "write", "destructive"],
  });
});

it("gives an action the key ring and the instance's address, as the screens do", async () => {
  const route = REST_ROUTES.find(
    (entry) => entry.action === "sso.updateConnection",
  );
  if (!route) {
    throw new Error("sso.updateConnection is not on the REST surface");
  }
  const segments = route.path.split("/").filter(Boolean);
  const request = new Request(`${ISSUER}/api/v1/${segments.join("/")}`, {
    method: route.method,
    headers: {
      authorization: "Bearer okr_test_token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: "connection-1", clientSecret: "rotated" }),
  });

  const response = await (route.method === "GET" ? rest.GET : rest.POST)(
    request as never,
    { params: Promise.resolve({ path: segments }) },
  );

  expect(response.status).toBe(200);
  expect(callAction).toHaveBeenCalledTimes(1);
  const [context, action] = callAction.mock.calls[0] as [
    Record<string, unknown>,
    string,
  ];
  expect(action).toBe("sso.updateConnection");
  expect(context.ring).toBe(RING);
  expect(context.baseUrl).toBe(ISSUER);
  expect(context.channel).toBe("api");
  // The token's scopes, as a ceiling for anything the action causes
  // (token-scope-ceiling.md).
  expect(context.scopes).toEqual(["read", "write", "destructive"]);
});

/** POSTs to one write's path, with an optional query string. */
const post = async (action: string, query: string, body: unknown) => {
  const route = REST_ROUTES.find((entry) => entry.action === action);
  if (!route) {
    throw new Error(`${action} is not on the REST surface`);
  }
  const segments = route.path.split("/").filter(Boolean);
  const request = new Request(
    `${ISSUER}/api/v1/${segments.join("/")}${query}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer okr_test_token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return rest.POST(request as never, {
    params: Promise.resolve({ path: segments }),
  });
};

it("checks a write without committing when asked to validate (plan D4)", async () => {
  const response = await post("goals.create", "?validate=true", {
    title: "Checked",
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      valid: true,
      input: { title: "Checked" },
      result: { id: "would-be" },
    },
  });
  expect(validateAction).toHaveBeenCalledTimes(1);
  expect(callAction).not.toHaveBeenCalled();
  const [context, action] = validateAction.mock.calls[0] as [
    Record<string, unknown>,
    string,
  ];
  expect(action).toBe("goals.create");
  expect(context.channel).toBe("api");
});

it("refuses a validate value it cannot read, before anything runs", async () => {
  const response = await post("goals.create", "?validate=maybe", {});
  expect(response.status).toBe(400);
  expect(validateAction).not.toHaveBeenCalled();
  expect(callAction).not.toHaveBeenCalled();
});
