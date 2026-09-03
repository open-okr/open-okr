/**
 * The OKR board, the task page and the rail (UIUX-PLAN.md §6 S-27 and S-28,
 * TECHNICAL-PLAN §4.9, P5-T11).
 *
 * Acceptance criterion:
 *   Given a key result whose linked tasks are all complete but whose measured
 *   value has not moved, when the divergence is computed, then it reports
 *   exactly that, naming both figures.
 *
 * **A browser rather than a unit test, because these are claims about screens.**
 * What the actions decide, including the row lock two concurrent drags need, is
 * proved against a real database in `packages/core/test/tasks.test.ts`. What
 * this proves is that a person can reach it: the board draws four columns, a
 * card moves and stays moved, the rail shows the two numbers apart, and the
 * sentence appears when they disagree.
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

const TASK = "Rewrite the first-run screen";

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

test("the sidebar reaches the board, and it says so when empty", async () => {
  await goTo(page, "/");
  await page.getByRole("link", { name: "Board" }).first().click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Board" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("board-count")).toContainText("No work");
  // Four columns, always, whether or not anything is in them.
  for (const label of ["Backlog", "To do", "In progress", "Done"]) {
    await expect(page.getByRole("region", { name: label })).toBeVisible();
  }
});

test("a card added against a key result lands in its column", async () => {
  await goTo(page, "/board");
  await page.getByLabel("What has to happen").fill(TASK);
  await page.getByLabel("Column").selectOption("todo");
  // The instance's own cycle has key results from the claiming spec; whichever
  // one is first is the one this work is recorded against.
  await page.getByLabel("Key result it moves").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add" }).click();

  const card = page.getByTestId("board-card").filter({ hasText: TASK });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "To do" })).toContainText(TASK);
});

test("the keyboard path moves it, and the move sticks", async () => {
  const card = page.getByTestId("board-card").filter({ hasText: TASK });
  await card.getByRole("button", { name: `Move ${TASK} on a column` }).click();

  await expect(page.getByRole("region", { name: "In progress" })).toContainText(
    TASK,
    { timeout: 15_000 },
  );

  await expect(async () => {
    const { rows } = await pool.query<{ status: string }>(
      "select status from tasks where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TASK],
    );
    expect(rows[0]?.status).toBe("in_progress");
  }).toPass({ timeout: 15_000 });
});

test("the rail shows the measure and the work as two separate numbers", async () => {
  const rail = page.getByTestId("rail-entry").first();
  await expect(rail).toBeVisible({ timeout: 15_000 });
  // Two chips, labelled differently. §4.9: the second never replaces the first.
  await expect(rail).toContainText("Progress");
  await expect(rail).toContainText("Linked work 0/1");
  await expect(page.getByTestId("rail-divergence")).toHaveCount(0);
});

test("acceptance: finishing the work says so, naming both figures", async () => {
  const card = page.getByTestId("board-card").filter({ hasText: TASK });
  await card.getByRole("button", { name: `Move ${TASK} on a column` }).click();

  await expect(page.getByRole("region", { name: "Done" })).toContainText(TASK, {
    timeout: 15_000,
  });

  const divergence = page.getByTestId("rail-divergence").first();
  await expect(divergence).toBeVisible({ timeout: 15_000 });
  await expect(divergence).toContainText("1 of 1 linked task complete");
  await expect(divergence).toContainText("still at its baseline");

  // And the measure itself has not moved, which is the whole point.
  const { rows } = await pool.query<{ progress_pct: string }>(
    `select k.progress_pct from key_results k
       join tasks t on t.key_result_id = k.id
      where t.workspace_id = $1 and t.title = $2 and t.deleted_at is null`,
    [workspaceId, TASK],
  );
  expect(Number(rows[0]?.progress_pct)).toBe(0);
});

test("the task page carries its checklist and its assignees", async () => {
  await goTo(page, "/board");
  await page.getByRole("link", { name: TASK }).click();

  await expect(page.getByRole("heading", { level: 1, name: TASK })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Add a line").fill("Draft the copy");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("task-checklist")).toContainText(
    "Draft the copy",
    { timeout: 15_000 },
  );

  await page
    .getByRole("button", { name: `Assign ${INSTANCE_ACCOUNT.name}` })
    .click();
  await expect(page.getByTestId("task-assignees")).toContainText(
    INSTANCE_ACCOUNT.name,
    { timeout: 15_000 },
  );
});

test("a finished task is not something you still owe", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("Due date").fill(today);

  await expect(async () => {
    const { rows } = await pool.query<{ due_on: string | null }>(
      "select due_on from tasks where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TASK],
    );
    expect(rows[0]?.due_on).not.toBeNull();
  }).toPass({ timeout: 15_000 });

  // The card is in Done from the acceptance test above. A due date on finished
  // work is not an obligation, and the inbox says nothing about it.
  await goTo(page, "/review");
  await expect(page.getByText(`Finish "${TASK}"`)).toHaveCount(0);
});

test("an unfinished one with a due date is, and it names the task", async () => {
  await goTo(page, `/tasks/${await taskId()}`);
  await page.getByLabel("Status").selectOption("todo");

  await expect(async () => {
    const { rows } = await pool.query<{ status: string }>(
      "select status from tasks where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TASK],
    );
    expect(rows[0]?.status).toBe("todo");
  }).toPass({ timeout: 15_000 });

  await goTo(page, "/review");
  await expect(page.getByText(`Finish "${TASK}"`)).toBeVisible({
    timeout: 15_000,
  });
});

/** The task this file works on, by its title. */
async function taskId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from tasks where workspace_id = $1 and title = $2 and deleted_at is null",
    [workspaceId, TASK],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("the task this file created is gone");
  }
  return id;
}
