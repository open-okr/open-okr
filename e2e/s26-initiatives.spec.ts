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
  // Exact: the comment editor's toolbar on this page has "Insert link".
  await page.getByRole("button", { name: "Link", exact: true }).click();

  await expect(page.getByTestId("linked-key-results")).toBeVisible({
    timeout: 15_000,
  });
});

/** The objective the initiative now serves, read from the link it made. */
async function servedObjective(): Promise<{ id: string; title: string }> {
  const { rows } = await pool.query<{ id: string; title: string }>(
    `select g.id, g.title from initiative_key_results ik
       join initiatives i on i.id = ik.initiative_id
       join key_results k on k.id = ik.key_result_id
       join goals g on g.id = k.goal_id
      where i.workspace_id = $1 and i.title = $2
        and ik.deleted_at is null and i.deleted_at is null
      limit 1`,
    [workspaceId, TITLE],
  );
  const served = rows[0];
  if (!served) {
    throw new Error("The initiative serves no key result. Did linking run?");
  }
  return served;
}

/** Marks the objective's kind in its drawer, the way a person would. */
async function markKind(kind: "committed" | "aspirational") {
  const served = await servedObjective();
  await goTo(page, `/goals?okr=${served.id}`);
  const drawer = page.getByTestId("okr-drawer");
  const picker = drawer.getByRole("combobox", {
    name: `Kind of ${served.title}`,
  });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  if ((await picker.inputValue()) === kind) {
    return;
  }
  await picker.selectOption(kind);
  await drawer
    .getByRole("textbox", { name: `Marking it ${kind}. Why?` })
    .press("Enter");
  await expect(async () => {
    const { rows } = await pool.query<{ kind: string }>(
      "select kind from goals where id = $1",
      [served.id],
    );
    expect(rows[0]?.kind).toBe(kind);
  }).toPass({ timeout: 15_000 });
}

test("the objective it serves is a commitment", async () => {
  // Gate five holds back only work a commitment depends on (METHOD.md §5.5,
  // P9-T11b-b); work serving an aspirational OKR may exceed capacity.
  await markKind("committed");
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

  // Put back as found: the objective was aspirational before this spec.
  await markKind("aspirational");
});

test("a filter that matches nothing says so, and says it differently", async () => {
  await goTo(page, "/initiatives?capacity=exceeds");
  await expect(page.getByTestId("initiative-count")).toContainText(
    "No initiative matches these filters",
  );
});

/**
 * The tasks panel, and the progress figure it makes true (S-26, P6-G28).
 *
 * **`initiatives.progress_pct` is a column nothing has ever written to**, so
 * every initiative in the product read nought per cent from P5-T11 until this
 * row, and the page carried a card saying so. The figure is derived from the
 * initiative's own tasks now, and the panel lists the tasks it is derived
 * from, which is what makes the number checkable rather than asserted.
 */
test("the initiative lists its tasks, and its progress matches them", async () => {
  await goTo(page, "/initiatives");
  await page.getByRole("link", { name: TITLE }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: TITLE }),
  ).toBeVisible({ timeout: 15_000 });

  // The card that said the panel had not been built is gone, and its promise
  // is kept rather than restated.
  await expect(page.getByText("What is not here yet")).toHaveCount(0);

  // An initiative nobody has broken down says so rather than drawing a zero
  // bar: that is not nought per cent done.
  await expect(
    page.getByRole("heading", { name: /^Tasks \(\d+ of \d+ done\)$/ }),
  ).toBeVisible();
  await expect(page.getByText("No tasks yet")).toBeVisible();
});

/**
 * S-26's documents, and the discussion beside them (completeness review
 * M-01).
 *
 * S-26 asks for documents on an initiative and REQUIREMENTS §4 puts comments
 * everywhere. The goal page was the only page with either; this one mounts
 * the same panels, and a comment on an initiative is a row the table itself
 * refused until migration 0103.
 */
test("the initiative carries documents and a discussion", async () => {
  // Still on the initiative from the case above.
  await expect(page.getByTestId("document-count")).toBeVisible({
    timeout: 15_000,
  });
  const thread = page.getByTestId("comment-thread");
  await expect(thread).toBeVisible();

  // The composer is the compact editor since guided-inputs §4.7, found by
  // its name. The posted comment is looked for among the posted ones: the
  // editor holds the same text until the post lands, so the thread as a whole
  // would contain it before anything was saved.
  await thread
    .getByRole("textbox", { name: "Your comment" })
    .fill("The flow needs a second designer.");
  await thread.getByRole("button", { name: "Post" }).click();
  await expect(
    thread
      .locator('[id^="comment-"]')
      .filter({ hasText: "The flow needs a second designer." }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(async () => {
    const { rows } = await pool.query<{ subject_type: string }>(
      `select c.subject_type from comments c
         join initiatives i on i.id = c.subject_id
        where i.workspace_id = $1 and i.title = $2 and c.deleted_at is null`,
      [workspaceId, TITLE],
    );
    expect(rows.map((row) => row.subject_type)).toEqual(["initiative"]);
  }).toPass({ timeout: 15_000 });
});
