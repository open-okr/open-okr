/**
 * Initiatives and the capacity check (UIUX-PLAN.md §6 S-26, METHOD.md §5.5,
 * P5-T10b).
 *
 * Acceptance criterion:
 *   Given a cycle whose gate five is red because of an initiative, when a
 *   facilitator opens the capacity view, then the initiative is named and one
 *   click reaches it.
 *
 * **A browser rather than a unit test, because the claims are about a screen.**
 * What the actions decide is proved against a real database in
 * `packages/core/test/initiatives.test.ts`. What this proves is that a person
 * can reach it: the module is in the sidebar, the list draws, an inline select
 * saves, and the red gate on the cycle screen leads to the project that made it
 * red.
 *
 * **The file name carries the run order:** specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

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
let workspaceId: string;

const TITLE = "Rebuild the activation flow";

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("sign in", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });

  const member = (
    await pool.query<{ workspace_id: string }>(
      `select m.workspace_id from workspace_members m
         join users u on u.id = m.user_id
        where u.email = $1
        limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  workspaceId = member.workspace_id;
});

test("the sidebar reaches it, and it says what it is for when empty", async () => {
  await goTo(page, "/");
  await page.getByRole("link", { name: "Initiatives" }).first().click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Initiatives" }),
  ).toBeVisible({ timeout: 15_000 });
  // The empty state names the rule rather than shrugging, which is the
  // difference between a screen and a blank page.
  await expect(page.getByTestId("initiative-count")).toContainText(
    "No work is recorded",
  );
});

test("adding one puts it in the list with its owner and its space", async () => {
  await goTo(page, "/initiatives");
  await page.getByLabel("What work is this").fill(TITLE);
  await page.getByRole("button", { name: "Add" }).click();

  const row = page.getByTestId("initiative").filter({ hasText: TITLE });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(INSTANCE_ACCOUNT.name);
  await expect(row).toContainText("not yet behind a key result");
});

test("the capacity select saves from the row itself", async () => {
  const row = page.getByTestId("initiative").filter({ hasText: TITLE });
  await row.getByLabel(`Capacity of ${TITLE}`).selectOption("exceeds");

  await expect(async () => {
    const { rows } = await pool.query<{ capacity: string | null }>(
      "select capacity from initiatives where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TITLE],
    );
    expect(rows[0]?.capacity).toBe("exceeds");
  }).toPass({ timeout: 15_000 });
});

test("linking it to a key result is done from the initiative itself", async () => {
  await goTo(page, "/initiatives");
  await page.getByRole("link", { name: TITLE }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: TITLE }),
  ).toBeVisible({ timeout: 15_000 });
  // The one field that reaches the method says so on the page, rather than
  // leaving a facilitator to discover it from a red gate.
  await expect(page.getByText("publish gate five")).toBeVisible();

  const picker = page.getByLabel("Key result to link");
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await picker.selectOption({ index: 0 });
  await page.getByRole("button", { name: "Link" }).click();

  await expect(page.getByTestId("linked-key-results")).toBeVisible({
    timeout: 15_000,
  });
});

test("acceptance: the red gate names the initiative and one click reaches it", async () => {
  await goTo(page, "/cycle?phase=5");

  const over = page.getByTestId("capacity-over");
  await expect(over).toBeVisible({ timeout: 15_000 });
  await expect(over).toContainText("Gate five refuses this set");

  await over.getByRole("link", { name: TITLE }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: TITLE }),
  ).toBeVisible({ timeout: 15_000 });
});

test("clearing the verdict takes it back out of the gate", async () => {
  await page.getByLabel("Capacity").selectOption("");

  // Wait for the write, not for the browser. Navigating straight after the
  // select raced the server action: the page loaded before the verdict landed
  // and the banner was still there, which reads as a product defect and is a
  // test that asked too early.
  await expect(async () => {
    const { rows } = await pool.query<{ capacity: string | null }>(
      "select capacity from initiatives where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TITLE],
    );
    expect(rows[0]?.capacity).toBeNull();
  }).toPass({ timeout: 15_000 });

  await goTo(page, "/cycle?phase=5");
  await expect(page.getByTestId("capacity-over")).toHaveCount(0, {
    timeout: 15_000,
  });
  // Unjudged is its own state, not a blank: §5.5 exists to end exactly this.
  await expect(page.getByText("no capacity verdict yet")).toBeVisible();
});

test("a filter that matches nothing says so, and says it differently", async () => {
  await goTo(page, "/initiatives?capacity=exceeds");
  await expect(page.getByTestId("initiative-count")).toContainText(
    "No initiative matches these filters",
  );
});
