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
import { expect, test } from "./fixtures.ts";
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
  // **No navigation, and that is the fix.** The test above signed in and left
  // this page on the Work Map. Asking for `/` again while the application is
  // still settling collides with a navigation the application starts itself,
  // and Playwright reports it as "interrupted by another navigation to /": the
  // same address it was asked for. Retrying does not help, because the
  // collision happens on every attempt. Waiting for the heading is what proves
  // the page is here (P5-T16, and again in P6-T01a when a retry was not
  // enough).
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });
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
  await page.getByRole("combobox", { name: /^Column/ }).selectOption("todo");
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

/**
 * S-28's comments, and the files beside them (completeness review M-01).
 *
 * The page used to say that comments and files were not kept on a task,
 * although both actions took one. It carries the goal page's own two panels
 * now.
 */
test("a task carries a discussion and files", async () => {
  await goTo(page, `/tasks/${await taskId()}`);
  const thread = page.getByTestId("comment-thread");
  await expect(thread).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("attachment-input")).toBeVisible();

  // The composer is the compact editor since guided-inputs §4.7, found by
  // its name. The posted comment is looked for among the posted ones: the
  // editor holds the same text until the post lands, so the thread as a whole
  // would contain it before anything was saved.
  await thread
    .getByRole("textbox", { name: "Your comment" })
    .fill("The copy is with legal.");
  await thread.getByRole("button", { name: "Post" }).click();
  await expect(
    thread
      .locator('[id^="comment-"]')
      .filter({ hasText: "The copy is with legal." }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(async () => {
    const { rows } = await pool.query<{ subject_type: string }>(
      `select c.subject_type from comments c
         join tasks t on t.id = c.subject_id
        where t.workspace_id = $1 and t.title = $2 and c.deleted_at is null`,
      [workspaceId, TASK],
    );
    expect(rows.map((row) => row.subject_type)).toEqual(["task"]);
  }).toPass({ timeout: 15_000 });
});

/**
 * Reordering within a column without a mouse (UIUX-PLAN §9, completeness
 * review M-02).
 *
 * The column buttons above move a card a whole column and to its top, so a
 * card's place inside a column could only be changed by dragging. This picks a
 * card up with Space, carries it with an arrow key, and puts it down with
 * Space: one `tasks.move`, the same write a drag makes.
 */
const SECOND = "Draft the pricing copy";

test("a card moves within its column with the keyboard alone, and stays there", async () => {
  await goTo(page, "/board");
  await page.getByLabel("What has to happen").fill(SECOND);
  await page.getByRole("combobox", { name: /^Column/ }).selectOption("todo");
  await page.getByRole("button", { name: "Add" }).click();

  const todo = page.getByRole("region", { name: "To do" });
  await expect(todo).toContainText(SECOND, { timeout: 15_000 });

  // The first task is in To do from the case above, and the new one lands
  // under it. Picked up, carried up one place, and put down.
  const announcer = page.getByTestId("board-announcer");
  await page.getByRole("button", { name: `Reorder ${SECOND}` }).focus();
  await page.keyboard.press("Space");
  await expect(announcer).toContainText(`Picked up ${SECOND}`);
  await page.keyboard.press("ArrowUp");
  await expect(announcer).toContainText("To do, position 1 of");
  await page.keyboard.press("Space");
  await expect(announcer).toContainText(`Dropped ${SECOND}`);

  await expect(async () => {
    const { rows } = await pool.query<{ title: string }>(
      `select title from tasks
        where workspace_id = $1 and status = 'todo' and deleted_at is null
          and title = any($2)
        order by position`,
      [workspaceId, [TASK, SECOND]],
    );
    expect(rows.map((row) => row.title)).toEqual([SECOND, TASK]);
  }).toPass({ timeout: 15_000 });

  // And a fresh read draws it there, which is the server's order and not the
  // browser's optimistic one.
  await goTo(page, "/board");
  await expect(
    page
      .getByRole("region", { name: "To do" })
      .getByTestId("board-card")
      .first(),
  ).toContainText(SECOND, { timeout: 15_000 });
});

/**
 * A board per key result and per initiative (REQUIREMENTS §4 Pillar C,
 * completeness review M-02). The read answered all three scopes from P5-T11 and
 * the screen drew only a space's.
 */
test("a key result's board holds the work behind it, one click from its goal", async () => {
  const { rows } = await pool.query<{ goal_id: string; title: string }>(
    `select k.goal_id, k.title from key_results k
       join tasks t on t.key_result_id = k.id
      where t.workspace_id = $1 and t.title = $2 and t.deleted_at is null`,
    [workspaceId, TASK],
  );
  const keyResult = rows[0];
  if (!keyResult) {
    throw new Error("the task this file created names no key result");
  }

  await goTo(page, `/goals/${keyResult.goal_id}`);
  await page
    .getByRole("link", { name: `The board of work behind ${keyResult.title}` })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: keyResult.title }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Key result board" })).toBeVisible();
  await expect(
    page.getByTestId("board-card").filter({ hasText: TASK }),
  ).toBeVisible();
  // The second card names no key result, so it is not this board's work.
  await expect(
    page.getByTestId("board-card").filter({ hasText: SECOND }),
  ).toHaveCount(0);
});

const THIRD = "Sketch the new first screen";

test("an initiative's board is one click from the initiative, and work added there is part of it", async () => {
  const { rows } = await pool.query<{ id: string; title: string }>(
    `select id, title from initiatives
      where workspace_id = $1 and deleted_at is null
      order by created_at limit 1`,
    [workspaceId],
  );
  const initiative = rows[0];
  if (!initiative) {
    throw new Error("No initiative. Did s26-initiatives.spec.ts run?");
  }

  await goTo(page, `/initiatives/${initiative.id}`);
  await page.getByRole("link", { name: "Open the board" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: initiative.title }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Initiative board" })).toBeVisible();

  await page.getByLabel("What has to happen").fill(THIRD);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(
    page.getByTestId("board-card").filter({ hasText: THIRD }),
  ).toBeVisible({ timeout: 15_000 });

  const made = await pool.query<{ initiative_id: string | null }>(
    "select initiative_id from tasks where workspace_id = $1 and title = $2 and deleted_at is null",
    [workspaceId, THIRD],
  );
  expect(made.rows[0]?.initiative_id).toBe(initiative.id);
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
