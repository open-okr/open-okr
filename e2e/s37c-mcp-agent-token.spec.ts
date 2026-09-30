/**
 * An agent token, for a local agent that cannot open a browser
 * (AI-NATIVE-PLAN.md §8.1, completeness review M-12).
 *
 * Acceptance criterion:
 *   Given a member who mints a read-only token for an AI agent on the tokens
 *   screen, when a local agent presents it as a bearer at the agent endpoint,
 *   then the agent can list and run reads, a write is refused as a tool result
 *   naming the scope it needed, and the token is refused at the REST surface
 *   while a REST token is refused at the agent endpoint.
 *
 * And the rule TECHNICAL-PLAN §8 states for every token: an agent token with
 * write scope cannot mint itself a wider one.
 *
 * A spec because the claim is about the page and the wire together: the page
 * mints the token and shows it inside the configuration an agent reads, and
 * the endpoint accepts exactly that. What a token resolves to is proved against
 * a real database in `packages/core/test/mcp-principal.test.ts`, and the rate
 * limits in `apps/web/test/public-door-limits.test.ts`.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
/** The raw tokens, held for this file only. They exist nowhere else. */
let agentToken = "";
let restToken = "";

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  // No cookies, so nothing here passes because a browser happened to be
  // signed in.
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

/** One JSON-RPC call, as an agent runtime makes it. */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  token = agentToken,
) {
  return api.post("/api/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      authorization: `Bearer ${token}`,
    },
    data: { jsonrpc: "2.0", id: 7, method, params },
  });
}

const bodyOf = async (response: Awaited<ReturnType<typeof rpc>>) => {
  const text = await response.text();
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("data:"));
  return JSON.parse(line ? line.slice(5).trim() : text) as Record<
    string,
    unknown
  >;
};

async function mint(
  name: string,
  forAgent: boolean,
  withWrite = false,
): Promise<string> {
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill(name);
  if (forAgent) {
    await page.getByRole("radio", { name: /An AI agent/ }).check();
  }
  await expect(page.getByRole("checkbox", { name: /^Read/ })).toBeChecked();
  if (withWrite) {
    await page.getByRole("checkbox", { name: /^Write/ }).check();
  }
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  return ((await shown.textContent()) ?? "").trim();
}

test("the tokens screen says how to connect an agent that cannot sign in", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await expect(
    page.getByText("Connect an agent that cannot sign in"),
  ).toBeVisible({ timeout: 10_000 });
  // The address in the example is the one the endpoint checks against.
  await expect(page.getByTestId("agent-configuration")).toContainText(
    "/api/mcp",
  );
});

test("mint an agent token, shown inside the configuration an agent reads", async () => {
  agentToken = await mint("Coding agent e2e", true);
  expect(agentToken).toMatch(/^okr_mcp_/);
  await expect(page.getByTestId("minted-agent-configuration")).toContainText(
    `Bearer ${agentToken}`,
  );
});

test("initialise with the agent token, and get no session", async () => {
  const response = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "a local agent", version: "1.0.0" },
  });
  expect(response.status()).toBe(200);
  // A session is recorded against a grant, and an agent token has none.
  expect(response.headers()["mcp-session-id"]).toBeUndefined();
  const result = (await bodyOf(response)).result as Record<string, unknown>;
  expect((result.serverInfo as Record<string, string>).name).toBe("OpenOKR");
});

test("runs a read the token carries the scope for", async () => {
  const body = await bodyOf(
    await rpc("tools/call", { name: "cycles.list", arguments: {} }),
  );
  const result = body.result as { isError?: boolean };
  expect(result.isError ?? false).toBe(false);
});

test("acceptance: a write is refused as a tool result naming the scope", async () => {
  const response = await rpc("tools/call", {
    name: "goals.create",
    arguments: { title: "Nothing an agent token should write" },
  });
  expect(response.status()).toBe(200);
  const result = (await bodyOf(response)).result as {
    isError: boolean;
    content: { text: string }[];
  };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("goals.create needs write");
});

test("the agent token is refused at the REST surface", async () => {
  const response = await api.get("/api/v1/goals/list", {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  expect(response.status()).toBe(401);
  expect((await response.json()).error.message).toContain("agent endpoint");
});

test("a REST token is refused at the agent endpoint, and told which to mint", async () => {
  restToken = await mint("Script e2e", false);
  expect(restToken).toMatch(/^okr_rest_/);

  const response = await rpc("tools/list", {}, restToken);
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toContain("invalid_token");
  expect(
    ((await response.json()) as Record<string, string>).error_description,
  ).toContain("agent token");
});

test("the list says which door each token opens, and when the agent last used it", async () => {
  await goTo(page, "/account/api-tokens");
  const agentRow = page
    .getByTestId("token-row")
    .filter({ hasText: "Coding agent e2e" });
  await expect(agentRow).toContainText("okr_mcp_");
  // Stamped by the calls above, so a person can tell which of their tokens is
  // still in an agent's configuration.
  await expect(agentRow).not.toContainText("last used never");

  const restRow = page.getByTestId("token-row").filter({ hasText: "Script e2e" });
  await expect(restRow).toContainText("REST");
  await expect(restRow).toContainText("okr_rest_");
});

test("a write-scoped agent token cannot mint itself a destructive one", async () => {
  const writer = await mint("Writing agent e2e", true, true);
  const response = await rpc(
    "tools/call",
    {
      name: "tokens.create",
      arguments: {
        name: "Wider than its maker",
        audience: "mcp",
        scopes: ["read", "write", "destructive"],
      },
    },
    writer,
  );
  expect(response.status()).toBe(200);
  const result = (await bodyOf(response)).result as {
    isError: boolean;
    content: { text: string }[];
  };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("tokens screen");

  // Nothing was minted: the list holds only what this page made.
  await goTo(page, "/account/api-tokens");
  await expect(
    page.getByTestId("token-row").filter({ hasText: "Wider than its maker" }),
  ).toHaveCount(0);
});

test("revoking the agent token stops the next call", async () => {
  await goTo(page, "/account/api-tokens");
  await page
    .getByTestId("token-row")
    .filter({ hasText: "Coding agent e2e" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(
    page.getByTestId("token-row").filter({ hasText: "Coding agent e2e" }),
  ).toContainText("revoked", { timeout: 10_000 });

  const response = await rpc("tools/list");
  expect(response.status()).toBe(401);
});
