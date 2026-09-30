/**
 * Deleting a goal, undoing it, and restoring it later (screen S-36,
 * completeness review M-13).
 *
 * Acceptance:
 *   Given a goal its champion deletes, when they press Undo in the toast on
 *   the page the delete sent them to, then the goal is back where it was.
 *   Given a goal deleted and left, when an administrator opens Deleted items
 *   and presses Restore, then the goal is back and the row is gone.
 *
 * **A browser, because the undo is a claim about two pages.** The delete sends
 * the reader to `/goals`, and the toast raised on the goal page has to be
 * waiting there. That the restore brings back the key results and refuses a
 * still-deleted parent is proved against a real database in
 * `packages/core/test/restore.test.ts`.
 *
 * **It makes its own goal and leaves it deleted.** Six later specs read the
 * instance's first goal, so this never touches that one, and the goal it makes
 * is deleted again at the end so no later spec meets a goal it did not expect.
 *
 * **The file name carries the run order:** specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`. `s36k` is the next admin card after
 * `s36j`.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
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
let goalId: string;

const TITLE = "Customers trust that nothing they delete is lost";

const deleted = async (): Promise<boolean> => {
  const { rows } = await pool.query<{ deleted: boolean }>(
    "select deleted_at is not null as deleted from goals where id = $1",
    [goalId],
  );
  return rows[0]?.deleted === true;
};

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("sign in and draft a goal of this spec's own", async () => {
  await signIn(page);
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

  // The drafting step's own form, which is the ordinary way a goal is made.
  await goTo(page, "/cycle?phase=4");
  await page.getByLabel("The objective").first().fill(TITLE);
  await page.getByRole("button", { name: "Add objective" }).first().click();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });

  await expect(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select id from goals
        where workspace_id = $1 and title = $2 and deleted_at is null
        order by created_at desc limit 1`,
      [workspaceId, TITLE],
    );
    expect(rows[0]?.id).toBeTruthy();
    goalId = rows[0]?.id as string;
  }).toPass({ timeout: 10_000 });
});

test("one press deletes it, and the page it lands on offers an undo", async () => {
  await goTo(page, `/goals/${goalId}`);
  await page.getByRole("button", { name: "Delete this goal" }).click();

  await page.waitForURL(/\/goals$/, { timeout: 15_000 });
  const toast = page.getByTestId("toast").filter({ hasText: "Goal deleted" });
  await expect(toast).toBeVisible();
  // What a delete is in this product, said where the undo is.
  await expect(toast).toContainText("Nothing is destroyed");
  await expect(toast).toContainText("Deleted items");
  expect(await deleted()).toBe(true);

  // Pressed at once: the window is six seconds, which is UIUX-PLAN §4's.
  await toast.getByRole("button", { name: "Undo" }).click();

  await page.waitForURL(new RegExp(`/goals/${goalId}$`), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByTestId("toast").filter({ hasText: "Goal restored." }),
  ).toBeVisible();
  expect(await deleted()).toBe(false);
});

test("the Deleted items screen is in the admin navigation", async () => {
  await goTo(page, "/admin");
  await expect(
    page.getByRole("link", { name: "Deleted items" }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("a goal left deleted is listed with who deleted it, and Restore brings it back", async () => {
  await goTo(page, `/goals/${goalId}`);
  await page.getByRole("button", { name: "Delete this goal" }).click();
  await page.waitForURL(/\/goals$/, { timeout: 15_000 });
  await expect.poll(deleted).toBe(true);

  await goTo(page, "/admin/deleted");
  await expect(
    page.getByRole("heading", { level: 1, name: "Deleted items" }),
  ).toBeVisible({ timeout: 15_000 });
  const row = page.getByTestId("deleted-item").filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Goal");
  await expect(row).toContainText(`Deleted by ${INSTANCE_ACCOUNT.name}`);

  await row.getByRole("button", { name: `Restore "${TITLE}"` }).click();

  await expect(
    page.getByTestId("toast").filter({ hasText: "Goal restored." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  expect(await deleted()).toBe(false);

  await goTo(page, `/goals/${goalId}`);
  await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("and it is left deleted, so no later spec meets it", async () => {
  await page.getByRole("button", { name: "Delete this goal" }).click();
  await page.waitForURL(/\/goals$/, { timeout: 15_000 });
  await expect.poll(deleted).toBe(true);
});
