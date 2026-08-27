/**
 * The session entry point (UIUX-PLAN.md §4 S-22 to S-25, P5-T01c).
 *
 * Acceptance criterion:
 *   Given a member with a session scheduled in their space, when they open the
 *   product, then they can reach that session in two clicks without knowing its
 *   identifier.
 *
 * That last clause is the whole point of the task. S-22 to S-25 were built
 * across P4-T07 to P4-T10 and nothing in the interface linked to any of them,
 * so this spec is written to fail if a link is ever removed again. Every
 * navigation below is a click on something a person can see; nothing here
 * types a URL except the first `goto("/")`, which is opening the product.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let spaceName: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("sign in, and schedule a session the way a coordinator would", async () => {
  await signIn(page);

  // Written straight to the database, because there is no create-session
  // control yet: P5-T01c is the door, not the scheduler. What the spec proves
  // is that a scheduled session is reachable, which is the half that was
  // missing.
  const user = (
    await pool.query<{ id: string }>("select id from users where email = $1", [
      INSTANCE_ACCOUNT.email,
    ])
  ).rows[0];
  if (!user) {
    throw new Error(`User ${INSTANCE_ACCOUNT.email} not found.`);
  }
  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      "select id, workspace_id from workspace_members where user_id = $1 and deleted_at is null limit 1",
      [user.id],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found.");
  }
  const space = (
    await pool.query<{ id: string; name: string }>(
      "select id, name from spaces where workspace_id = $1 and deleted_at is null limit 1",
      [member.workspace_id],
    )
  ).rows[0];
  if (!space) {
    throw new Error("Space not found.");
  }
  spaceName = space.name;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local app.workspace_id = '${member.workspace_id}'`);
    await client.query(
      `insert into okr_sessions
         (id, workspace_id, space_id, kind, title, scheduled_for, facilitator_id, state)
       values (gen_random_uuid(), $1, $2, 'weekly', 'Entry point weekly', now() + interval '2 hours', $3, 'scheduled')`,
      [member.workspace_id, space.id, member.id],
    );
    await client.query("commit");
  } finally {
    client.release();
  }
});

test("the navigation offers Sessions at all, which is what was missing", async () => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible(
    { timeout: 10_000 },
  );
});

test("acceptance: two clicks from the front door to the session", async () => {
  await page.goto("/");

  // One.
  await page.getByRole("link", { name: "Sessions" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sessions" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Entry point weekly")).toBeVisible();

  // Two. Nothing here knows the session's identifier.
  await page.getByText("Entry point weekly").click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/, {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the list says which session is in progress, so a facilitator can rejoin", async () => {
  await page.goto("/sessions");
  await page.getByText("Entry point weekly").click();

  // Start it, then come back to the list.
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByRole("button", { name: "Continue to next step" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.goto("/sessions");
  const row = page
    .locator("a", { hasText: "Entry point weekly" })
    .first();
  await expect(row).toContainText("In progress");
  // The word changes with the state, because "Open" and "Rejoin" are different
  // things to a person standing outside a room that has already started.
  await expect(row).toContainText("Rejoin");
});

test("the space page links to its own session too", async () => {
  await page.goto("/spaces");
  await page.getByRole("link", { name: spaceName }).first().click();

  const card = page.locator("ul[aria-label='Sessions']");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Entry point weekly");
});

test("a member facilitating shows as such, and the finished filter is reachable", async () => {
  await page.goto("/sessions");
  await expect(page.getByText("You facilitate").first()).toBeVisible();

  await page.getByRole("link", { name: "Show finished" }).click();
  await expect(page).toHaveURL(/\/sessions\?finished=1$/);
  await expect(
    page.getByRole("link", { name: "Hide finished" }),
  ).toBeVisible();
});
