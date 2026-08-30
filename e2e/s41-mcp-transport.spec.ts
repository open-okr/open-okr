/**
 * The agent endpoint, over the real transport (AI-NATIVE-PLAN.md §8.3,
 * P5-T09b).
 *
 * Acceptance criterion:
 *   Given an external agent holding read scope, when it calls a write tool,
 *   then the call is denied by the permission layer, the denial is audited, and
 *   the agent receives a clear error rather than a partial result.
 *
 * A spec rather than a unit test because the claim is about a wire protocol.
 * What the dispatch decides is proved against a real database in
 * `packages/core/test/mcp-dispatch.test.ts`; what this proves is that a client
 * holding nothing but an access token can reach it: the endpoint is not behind
 * the session gate, the token is resolved per request, the version is
 * negotiated, and a refusal comes back as a tool result an agent can read
 * rather than a transport fault it would retry.
 */
import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

const REDIRECT = "http://127.0.0.1:7788/callback";
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let accessToken = "";
let sessionId = "";
let base = "";

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  base = (baseURL ?? "").replace(/\/+$/, "");
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

/** One JSON-RPC call over the transport, as an agent runtime makes it. */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  over: { readonly token?: string; readonly session?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Both, because the transport answers either and a client that asks for
    // only JSON gets a 406 from a stricter reading of the specification.
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  const token = over.token ?? accessToken;
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const session = over.session ?? sessionId;
  if (session) {
    headers["mcp-session-id"] = session;
  }

  const response = await api.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: Math.floor(Math.random() * 1e9), method, params },
  });
  return response;
}

const bodyOf = async (response: Awaited<ReturnType<typeof rpc>>) => {
  const text = await response.text();
  // The transport answers JSON here, but a client has to cope with either, and
  // reading the event stream's data line is what an agent runtime does.
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("data:"));
  return JSON.parse(line ? line.slice(5).trim() : text) as Record<
    string,
    unknown
  >;
};

test("the endpoint is not behind the session gate, and says where to get a token", async () => {
  // The defect this shape has produced twice: a redirect here would answer
  // every tool call with the sign-in page at status 200.
  const response = await api.post("/api/mcp", {
    headers: { "content-type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });

  expect(response.status()).toBe(401);
  // RFC 9728 §5.1: the challenge turns a 401 into the first step of the flow.
  expect(response.headers()["www-authenticate"]).toContain("resource_metadata");
});

test("a token this instance never issued is refused, and says nothing else", async () => {
  const response = await rpc("tools/list", {}, { token: "okr_at_invented" });
  expect(response.status()).toBe(401);
});

test("connect an agent and hold its access token", async () => {
  await signIn(page);
  const params = new URLSearchParams({
    client_id: "openokr-cli",
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Read only, deliberately: the acceptance criterion is about what this
    // cannot do.
    scope: "read",
    state: "mcp-spec",
  });
  await goTo(page, `/oauth/authorize?${params.toString()}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Connect an agent" }),
  ).toBeVisible({ timeout: 10_000 });

  const [decision] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/oauth/authorize/decide") &&
        candidate.status() === 303,
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: "Connect" }).click(),
  ]);
  const code = new URL(decision.headers().location ?? "").searchParams.get(
    "code",
  );

  const tokens = await api.post("/api/mcp/token", {
    form: {
      grant_type: "authorization_code",
      code: code ?? "",
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    },
  });
  expect(tokens.status()).toBe(200);
  accessToken = ((await tokens.json()) as Record<string, string>)
    .access_token as string;
});

test("a version this server cannot speak is refused, not guessed at", async () => {
  const response = await api.post("/api/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      "mcp-protocol-version": "1999-01-01",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });

  expect(response.status()).toBe(400);
  const body = (await response.json()) as Record<string, string>;
  expect(body.error).toBe("unsupported_protocol_version");
  // Names what it can speak, so a client falls back rather than guesses.
  expect(body.error_description).toContain("2025-06-18");
});

test("an origin this instance does not serve is refused", async () => {
  // The rebinding defence: a page in a browser talked into pointing here.
  const response = await api.post("/api/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      origin: "https://attacker.test",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(response.status()).toBe(403);
});

test("initialise, and hold the session the transport gives back", async () => {
  const response = await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "a spec", version: "1.0.0" },
    },
    { session: "" },
  );

  expect(response.status()).toBe(200);
  sessionId = response.headers()["mcp-session-id"] ?? "";
  expect(sessionId.length).toBeGreaterThan(0);

  const body = await bodyOf(response);
  const result = body.result as Record<string, unknown>;
  expect((result.serverInfo as Record<string, string>).name).toBe("OpenOKR");
});

test("lists the tools, with their scopes and safety hints intact", async () => {
  const body = await bodyOf(await rpc("tools/list"));
  const tools = (body.result as { tools: Record<string, unknown>[] }).tools;

  expect(tools.length).toBeGreaterThan(200);

  const destroy = tools.find((tool) => tool.name === "goals.delete");
  expect(destroy).toBeDefined();
  // What a client shows a person before it lets an agent call this.
  expect(
    (destroy?.annotations as Record<string, boolean>).destructiveHint,
  ).toBe(true);
  expect((destroy?.annotations as Record<string, boolean>).readOnlyHint).toBe(
    false,
  );
});

test("runs a read the grant carries the scope for", async () => {
  const body = await bodyOf(
    await rpc("tools/call", { name: "cycles.list", arguments: {} }),
  );
  const result = body.result as { isError?: boolean };
  expect(result.isError ?? false).toBe(false);
});

test("acceptance: a read-scoped agent calling a write tool is denied, clearly", async () => {
  const response = await rpc("tools/call", {
    name: "goals.create",
    arguments: { title: "Nothing should be written" },
  });

  // Not a transport fault. A 200 carrying `isError` is what lets an agent
  // report a denial instead of retrying it.
  expect(response.status()).toBe(200);
  const result = (await bodyOf(response)).result as {
    isError: boolean;
    content: { text: string }[];
  };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("goals.create needs write");
});

test("the denial wrote nothing, which is what a partial result would mean", async () => {
  const body = await bodyOf(
    await rpc("tools/call", { name: "goals.list", arguments: {} }),
  );
  const result = body.result as { content: { text: string }[] };
  expect(result.content[0]?.text).not.toContain(
    "Nothing should be written",
  );
});

test("lists the resources and the prompts it offers", async () => {
  const resources = await bodyOf(await rpc("resources/templates/list"));
  const templates = (
    resources.result as { resourceTemplates: { uriTemplate: string }[] }
  ).resourceTemplates;
  expect(templates.some((one) => one.uriTemplate.startsWith("openokr://goal/"))).toBe(
    true,
  );

  const prompts = await bodyOf(await rpc("prompts/list"));
  const listed = (prompts.result as { prompts: { name: string }[] }).prompts;
  expect(listed.map((one) => one.name)).toContain("what-do-i-owe");
});

test("the session was recorded against the grant, and appears as connected", async () => {
  await goTo(page, "/account/connections");
  const connection = page.getByTestId("connection").first();
  await expect(connection).toContainText("The OpenOKR command line", {
    timeout: 10_000,
  });
  await expect(connection).toContainText("read");
});

test("revoking the connection stops the next call on the same session", async () => {
  await goTo(page, "/account/connections");
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByTestId("connection").first()).toContainText(
    "revoked",
    { timeout: 10_000 },
  );

  // The session identifier is a record, never an authority: the token on this
  // request is resolved from scratch and its grant is gone.
  const response = await rpc("tools/call", {
    name: "cycles.list",
    arguments: {},
  });
  expect(response.status()).toBe(401);
});
