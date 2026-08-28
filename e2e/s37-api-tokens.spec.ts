/**
 * API tokens and the versioned REST surface (TECHNICAL-PLAN §14, P5-T07a).
 *
 * Acceptance criterion:
 *   Given a token minted with read scope only, when it is presented to any
 *   write action on the versioned surface, then the call is refused for scope
 *   before the action runs, and the refusal names the scope it needed.
 *
 * "Before the action runs" is why this spec exists rather than a unit test. The
 * scope gate lives in the transport, and the only way to prove a write was
 * refused *and nothing was written* is to make the request over HTTP and then
 * look. Everything a token is, hashed and audience-bound and dead on
 * revocation, is proved against a real database in
 * `packages/core/test/api-tokens.test.ts`.
 */
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

const execFileAsync = promisify(execFile);

/**
 * The `okr` tool, run as a process (P5-T07c-a).
 *
 * Spawned rather than imported, because the acceptance criterion is about a
 * terminal: what is being proved is that the bin resolves the generated command
 * list, parses the flags, reads the profile and reaches the running instance.
 * Importing `run` would skip the first and the last of those.
 */
async function okr(
  args: readonly string[],
  configFile: string,
): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "packages/cli/src/bin/okr.ts",
        ...args,
      ],
      { env: { ...process.env, OPENOKR_CONFIG: configFile } },
    );
    return { code: 0, out: stdout, err: stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      out: failure.stdout ?? "",
      err: failure.stderr ?? "",
    };
  }
}

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
/** The raw token, held for this file only. It exists nowhere else. */
let token = "";
/** The instance's address, captured from the project's own baseURL. */
let base = "";
const baseUrl = (): string => base;

const authed = (value = token) => ({
  authorization: `Bearer ${value}`,
});

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  base = baseURL ?? "";
  context = await browser.newContext();
  page = await context.newPage();
  // A request context with no cookies, so nothing here can pass because a
  // browser session happened to be signed in.
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test("mint a read-only token, shown once", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await expect(
    page.getByRole("heading", { level: 1, name: "API tokens" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Name").fill("Read-only e2e");
  // Read is checked by default; make the intent explicit rather than relying
  // on it, because the whole test turns on this one box.
  await expect(page.getByRole("checkbox", { name: "Read" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Write" })).not.toBeChecked();
  await page.getByRole("button", { name: "Create token" }).click();

  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
  expect(token).toMatch(/^okr_rest_/);
});

test("the token is never shown again", async () => {
  await goTo(page, "/account/api-tokens");
  await expect(page.getByTestId("token-row").first()).toContainText(
    "Read-only e2e",
  );
  // The prefix is on the row. The rest of the token is not on the page at all.
  await expect(page.getByTestId("minted-token")).toHaveCount(0);
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toContain(token);
});

test("a read works", async () => {
  const response = await api.get("/api/v1/goals/list", {
    headers: authed(),
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data).toHaveProperty("goals");
});

test("the index lists the surface, for a caller that holds a token", async () => {
  const response = await api.get("/api/v1", { headers: authed() });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.version).toBe("v1");
  const listed = body.data.actions as { action: string; method: string }[];
  expect(listed.length).toBeGreaterThan(100);
  expect(listed.find((row) => row.action === "goals.list")?.method).toBe("GET");
});

test("the OpenAPI document describes the surface it is served from", async () => {
  const response = await api.get("/api/v1/openapi.json", { headers: authed() });
  expect(response.status()).toBe(200);
  const document = await response.json();
  expect(document.openapi).toBe("3.1.0");
  // Generated from the registry on request, so it describes this instance
  // rather than whatever was committed. `pnpm check:contract` keeps the
  // committed copy honest; this proves the running one is real.
  expect(document.paths["/goals/list"].get["x-openokr-scope"]).toBe("read");
  expect(document.servers[0].url).toBe("/api/v1");
});

test("the command line runs a read as the member whose token it holds (P5-T07c-a acceptance)", async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), "okr-e2e-")), "config.json");

  const saved = await okr(
    ["login", "--url", baseUrl(), "--token", token],
    configFile,
  );
  expect(saved.code).toBe(0);
  // The token is not printed back, even by the command that was given it.
  expect(saved.out).not.toContain(token);

  const listed = await okr(["goals", "list"], configFile);
  expect(listed.code).toBe(0);
  // Clean JSON on stdout, which is what makes it pipeable.
  expect(JSON.parse(listed.out)).toHaveProperty("goals");

  // And a mistyped flag is refused before anything is sent: exit 2, the usage
  // code, rather than 1, which is the instance refusing.
  const mistyped = await okr(
    ["goals", "list", "--level", "marketing"],
    configFile,
  );
  expect(mistyped.code).toBe(2);
  expect(mistyped.err).toContain("--level must be one of");
});

test("the command line carries the instance's own refusal", async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), "okr-e2e-")), "config.json");
  await okr(["login", "--url", baseUrl(), "--token", token], configFile);

  // A read token on a write action, and one whose flags are all satisfiable, so
  // the tool does not refuse it first: what is being tested is the sentence a
  // person reads, and it is the one the surface wrote rather than one the tool
  // invented over the top of a status code.
  const refused = await okr(
    ["people", "updateOwnProfile", "--timezone", "Asia/Jakarta"],
    configFile,
  );
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("write scope");
  expect(refused.err).toContain("people.updateOwnProfile");
});

test("a write is refused for scope, and the refusal names the scope (acceptance)", async () => {
  const response = await api.post("/api/v1/goals/create", {
    headers: authed(),
    data: {
      level: "team",
      ownerKind: "space",
      title: "A goal a read token must not be able to create",
    },
  });

  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body.error.code).toBe("insufficient_scope");
  expect(body.error.message).toContain("write");
  expect(body.error.message).toContain("goals.create");
  // Refused *before* the action ran: the input above is incomplete, so an
  // action that had been reached would have answered 422 about its fields
  // instead. A scope gate that ran second would show up right here.
  expect(body.error.fields).toBeUndefined();

  // And nothing was written. The read the same token can do proves it.
  const listed = await api.get("/api/v1/goals/list", { headers: authed() });
  const goals = (await listed.json()).data.goals as { title: string }[];
  expect(
    goals.some((goal) =>
      goal.title.includes("A goal a read token must not be able to create"),
    ),
  ).toBe(false);
});

test("a destructive action needs more than write", async () => {
  const response = await api.post("/api/v1/tokens/revoke", {
    headers: authed(),
    data: { id: "7f3c1d2e-0000-4000-8000-000000000000" },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.message).toContain("destructive");
});

test("no token is 401, and a wrong one says nothing about the instance", async () => {
  const none = await api.get("/api/v1/goals/list");
  expect(none.status()).toBe(401);
  expect((await none.json()).error.code).toBe("unauthenticated");

  const wrong = await api.get("/api/v1/goals/list", {
    headers: { authorization: `Bearer okr_rest_${"a".repeat(43)}` },
  });
  expect(wrong.status()).toBe(401);
  expect((await wrong.json()).error.message).toBe("That is not a valid token.");
});

test("the method carries the meaning, so a write is not a GET", async () => {
  const response = await api.get("/api/v1/goals/create", {
    headers: authed(),
  });
  expect(response.status()).toBe(405);
  expect((await response.json()).error.code).toBe("method_not_allowed");
});

test("an action that does not exist is a 404 that points at the index", async () => {
  const response = await api.get("/api/v1/goals/somethingElse", {
    headers: authed(),
  });
  expect(response.status()).toBe(404);
  const body = await response.json();
  expect(body.error.code).toBe("unknown_action");
  expect(body.error.message).toContain("/api/v1");
});

test("a mistyped parameter is refused by name rather than ignored", async () => {
  const response = await api.get("/api/v1/goals/list?spaceID=x", {
    headers: authed(),
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error.code).toBe("unsupported_parameter");
  expect(body.error.message).toContain("spaceID");
  expect(body.error.message).toContain("spaceId");
});

test("a forbidden resource is a not-found, not a hint that it exists", async () => {
  // A well-formed id nobody owns. §14: forbidden collapses to not-found for a
  // resource the reader cannot see, and it collapses inside core, so what
  // arrives here is already the right answer.
  const response = await api.get(
    "/api/v1/goals/read?id=7f3c1d2e-0000-4000-8000-000000000000",
    { headers: authed() },
  );
  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe("not_found");
});

test("revoking one stops it working, and says which reason", async () => {
  await goTo(page, "/account/api-tokens");
  await page
    .getByTestId("token-row")
    .filter({ hasText: "Read-only e2e" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(
    page.getByTestId("token-row").filter({ hasText: "Read-only e2e" }),
  ).toContainText("revoked", { timeout: 10_000 });

  const response = await api.get("/api/v1/goals/list", { headers: authed() });
  expect(response.status()).toBe(401);
  // The holder of a revoked token learns that it was revoked. They hold the
  // pre-image of a stored digest, so this reveals nothing, and it saves an
  // afternoon.
  expect((await response.json()).error.message).toBe(
    "That token has been revoked.",
  );
});
