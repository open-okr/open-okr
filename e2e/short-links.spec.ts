/**
 * Short links (docs/design/short-ids.md, plan 0.7.0 D1).
 *
 * Acceptance criteria:
 *   Given a goal, when a person presses "Copy link" on its page, then the
 *   clipboard holds the goal's short-id address, and opening it lands on the
 *   goal's page.
 *   Given each of the seven (a cycle, a goal, a key result, an initiative, a
 *   task, a document, a session), its page offers a short link and the link
 *   opens that page.
 *   Given a short id that names nothing, then the not-found page.
 *   Given the REST surface, when it is asked for a goal by its short id, then
 *   it answers the goal, keyed by its UUID.
 *
 * **What the resolver decides** (who may see what, malformed, unknown and
 * unseen answering alike) is proved against a database in
 * `packages/core/test/short-ids.test.ts`. What this proves is the browser's
 * half: the button, the clipboard and the route that takes a short id.
 *
 * **A spec file may rely on the claim and nothing else**, so everything it
 * opens it makes first, through the API with a token it mints, the way
 * `s43-accessibility.spec.ts` makes its missing rows.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let api: APIRequestContext;
let token: string;

/** What the spec made, by kind, each with the short id the write gave it. */
const made: Record<string, { id: string; shortId: string }> = {};
let goalTitle = "";

const shortIdOf = async (table: string, id: string): Promise<string> => {
  const { rows } = await pool.query<{ short_id: string | null }>(
    `select short_id from ${table} where id = $1`,
    [id],
  );
  const shortId = rows[0]?.short_id;
  if (!shortId) {
    throw new Error(`${table} ${id} has no short id. Every write gives one.`);
  }
  return shortId;
};

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext({
    // The button writes to the clipboard and the test reads it back. Chromium
    // grants both on localhost, which is a secure context.
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL: baseURL ?? "" });
});

test.afterAll(async () => {
  await api?.dispose();
  await pool?.end();
  await context?.close();
});

const post = async (action: string, data: unknown) => {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: { authorization: `Bearer ${token}` },
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as { id: string };
};

test("sign in and make one of each of the seven", async () => {
  await signIn(page);

  const mine = (
    await pool.query<{
      workspace_id: string;
      member_id: string;
      space_id: string;
    }>(
      `select m.workspace_id::text, m.id::text as member_id,
              sm.space_id::text as space_id
         from workspace_members m
         join users u on u.id = m.user_id
         join space_members sm on sm.member_id = m.id and sm.deleted_at is null
        where u.email = $1 and m.deleted_at is null
        order by m.created_at, sm.created_at
        limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!mine) {
    throw new Error("The instance account belongs to no space.");
  }

  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Short links e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const current = await api.get("/api/v1/cycles/current?mode=quarterly", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(current.status()).toBe(200);
  const cycle = (await current.json()).data as { id: string };

  goalTitle = `Short links land where they point ${Date.now()}`;
  const goal = await post("goals.create", {
    title: goalTitle,
    cycleId: cycle.id,
    level: "team",
    ownerKind: "space",
    spaceId: mine.space_id,
    championId: mine.member_id,
    reviewerId: mine.member_id,
    weight: 1,
  });
  const keyResult = await post("goals.addKeyResult", {
    goalId: goal.id,
    title: "Short links opened from 0 to 20",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 0,
    targetValue: 20,
    weight: 1,
  });
  const initiative = await post("initiatives.create", {
    spaceId: mine.space_id,
    title: "Short links initiative",
    ownerId: mine.member_id,
  });
  const task = await post("tasks.create", {
    spaceId: mine.space_id,
    title: "Short links task",
  });
  const document = await post("documents.create", {
    subjectType: "goal",
    subjectId: goal.id,
    title: "Short links document",
  });
  await post("documents.publish", { id: document.id });
  const session = await post("sessions.create", {
    spaceId: mine.space_id,
    kind: "weekly",
    title: "Short links weekly",
    scheduledFor: new Date().toISOString(),
    facilitatorId: mine.member_id,
  });

  for (const [kind, table, id] of [
    ["cycle", "cycles", cycle.id],
    ["goal", "goals", goal.id],
    ["key_result", "key_results", keyResult.id],
    ["initiative", "initiatives", initiative.id],
    ["task", "tasks", task.id],
    ["document", "documents", document.id],
    ["session", "okr_sessions", session.id],
  ] as const) {
    made[kind] = { id, shortId: await shortIdOf(table, id) };
  }
});

test("REST answers a goal by its short id, keyed by its UUID", async () => {
  const goal = made.goal as { id: string; shortId: string };
  const response = await api.get(
    `/api/v1/goals/read?id=${encodeURIComponent(goal.shortId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.id).toBe(goal.id);
  expect(body.data.shortId).toBe(goal.shortId);

  // A short id that names nothing is not-found, never a validation error.
  const missing = await api.get("/api/v1/goals/read?id=Zz9Zz9Zz9Z", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(missing.status()).toBe(404);
});

test("Copy link on a goal puts its short link on the clipboard, and the link opens the goal (acceptance)", async () => {
  const goal = made.goal as { id: string; shortId: string };
  await goTo(page, `/goals/${goal.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: goalTitle }),
  ).toBeVisible({ timeout: 15_000 });

  const button = page
    .getByTestId("copy-link")
    .filter({ hasText: "Copy link" })
    .first();
  await expect(button).toHaveAttribute("data-path", `/goals/${goal.shortId}`);
  await button.click();
  await expect(page.getByText("Copied").first()).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(new RegExp(`^https?://[^/]+/goals/${goal.shortId}$`));

  await goTo(page, new URL(copied).pathname);
  await expect(page).toHaveURL(new RegExp(`/goals/${goal.id}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: goalTitle }),
  ).toBeVisible({ timeout: 15_000 });
});

test("a key result's link opens its goal at its row", async () => {
  const goal = made.goal as { id: string; shortId: string };
  const keyResult = made.key_result as { id: string; shortId: string };
  await goTo(page, `/goals/${goal.id}`);
  await expect(
    page.locator(`[data-path="/key-results/${keyResult.shortId}"]`),
  ).toBeVisible({ timeout: 15_000 });

  await goTo(page, `/key-results/${keyResult.shortId}`);
  await expect(page).toHaveURL(
    new RegExp(`/goals/${goal.id}#kr-${keyResult.id}$`),
  );
});

test("each of the other five offers its short link, and the link opens it", async () => {
  const pages = [
    {
      kind: "initiative",
      byKey: (id: string) => `/initiatives/${id}`,
      short: (s: string) => `/initiatives/${s}`,
    },
    {
      kind: "task",
      byKey: (id: string) => `/tasks/${id}`,
      short: (s: string) => `/tasks/${s}`,
    },
    {
      kind: "document",
      byKey: (id: string) => `/documents/${id}`,
      short: (s: string) => `/documents/${s}`,
    },
    {
      kind: "session",
      byKey: (id: string) => `/session/${id}`,
      short: (s: string) => `/session/${s}`,
    },
    {
      kind: "cycle",
      byKey: (id: string) => `/cycle?cycle=${id}`,
      short: (s: string) => `/cycle?cycle=${s}`,
    },
  ] as const;

  for (const one of pages) {
    const thing = made[one.kind] as { id: string; shortId: string };
    await goTo(page, one.byKey(thing.id));
    await expect(
      page.locator(`[data-testid="copy-link"][data-path="${one.short(thing.shortId)}"]`),
      one.kind,
    ).toBeVisible({ timeout: 15_000 });

    await goTo(page, one.short(thing.shortId));
    await expect(page, one.kind).toHaveURL(
      new RegExp(one.byKey(thing.id).replace("?", "\\?")),
    );
    await expect(page.getByRole("heading", { name: "Not found" })).toHaveCount(
      0,
    );
  }
});

test("a short link that names nothing is the not-found page", async () => {
  await goTo(page, "/goals/Zz9Zz9Zz9Z");
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(page.url()).not.toMatch(new RegExp(UUID));
});
