/**
 * A check-in is published, acknowledged and voted on in a browser
 * (completeness review L-17, UIUX-PLAN.md §4 S-15, METHOD.md §6.5 and §7.2).
 *
 * **Why this could not be done before, and why it can now.** The walker spec
 * in `registration-to-dashboard.spec.ts` left publishing out because making a
 * goal due needs the database, and a goal created today with a Monday anchor
 * is due next Monday. That spec has no database handle by design. This one
 * does, the way `reviews.spec.ts` does, and uses it for exactly one thing: to
 * move one goal's next check-in into the past. Everything after that is a
 * person using the screen.
 *
 * **The goal is this file's own.** Publishing moves the cadence and voting
 * leaves a vote behind, so doing either to the goal another spec reads would
 * change what that spec sees. A goal nobody else knows about changes nothing.
 *
 * **One account, on purpose.** The drafting form names the reader as both
 * champion and reviewer, which is a real shape for a workspace of one and the
 * only one this instance can sign into. The reviewer of record is copied onto
 * the check-in when it is published, so acknowledging it here is the same
 * check a second person would pass.
 *
 * **The file name carries the run order.** Specs run alphabetically against
 * one instance, and `registration-to-dashboard.spec.ts` claims it and opens
 * drafting. `s15` is screen S-15.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OBJECTIVE = "Every team reports on its own goals each week";
const KEY_RESULT = "Raise weekly check-in completion from 40 to 80";
const NARRATIVE =
  "Two teams started posting on Mondays. The platform team is still waiting on access to the board.";
const NEXT_STEP = "Ask the platform lead for board access";
const CORRECTION = " by Tuesday";
const NARRATIVE_LABEL = "What moved, what is in the way, what happens next";

// The superuser, for the reason `reviews.spec.ts` gives: every business table
// carries forced row-level security, and the one update below has to reach a
// goal before it could set the workspace.
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let goalId = "";

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

const history = () => page.getByRole("article").filter({ hasText: NARRATIVE });
// The narrative as the card shows it, apart from the copy loaded into the
// card's own edit field: its first paragraph, and the list under it.
const shownParagraph = () =>
  history().locator(":scope > .rich-text > p").first();
const shownList = () => history().locator(":scope > .rich-text > ul > li");

test("a goal of this reader's own, with one key result, is due", async () => {
  await goTo(page, "/cycle?phase=4");

  // Retry-safe: continuous integration retries once, and a second objective
  // with the same sentence would make every locator below ambiguous.
  const existing = page.getByRole("heading", { level: 2, name: OBJECTIVE });
  if ((await existing.count()) === 0) {
    await page.getByLabel("The objective").first().fill(OBJECTIVE);
    await page
      .locator("#goal-champion")
      .selectOption({ label: `Champion: ${INSTANCE_ACCOUNT.name}` });
    await page
      .locator("#goal-reviewer")
      .selectOption({ label: `Reviewer: ${INSTANCE_ACCOUNT.name}` });
    await page.getByRole("button", { name: "Add objective" }).first().click();
    await expect(existing).toBeVisible({ timeout: 15_000 });
  }

  const form = page.getByRole("form", {
    name: `Add a key result to ${OBJECTIVE}`,
  });
  goalId = await form.locator('input[name="goalId"]').inputValue();
  if ((await page.getByText(KEY_RESULT, { exact: true }).count()) === 0) {
    await form.getByRole("textbox", { name: "The key result" }).fill(KEY_RESULT);
    await form.getByRole("spinbutton", { name: "Baseline" }).fill("40");
    await form.getByRole("spinbutton", { name: "Target" }).fill("80");
    await form.getByRole("button", { name: "Add key result" }).click();
    await expect(page.getByText(KEY_RESULT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  }

  // The one thing a browser cannot do: be an hour past the check-in date.
  const moved = await pool.query(
    `update goals set next_check_in_at = now() - interval '1 hour'
      where id = $1 and deleted_at is null`,
    [goalId],
  );
  expect(moved.rowCount).toBe(1);
});

test("the walker offers it, and publishing puts the card in the history", async () => {
  expect(goalId, "the drafting form named no goal").not.toBe("");
  await goTo(page, "/check-in");
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(`^${OBJECTIVE}`) })
    .click();
  await expect(page).toHaveURL(`/check-in?goal=${goalId}`);

  await page.getByLabel(`New value for ${KEY_RESULT}`).fill("60");
  await page.getByLabel("Status", { exact: true }).selectOption("caution");
  // The compact editor (guided-inputs §4.7): the narrative is typed in bold
  // from the toolbar, and the next step goes in a bulleted list under it.
  // Each step waits for the editor to show the last one, because a toolbar
  // press acts on wherever the editor's own selection is at that moment.
  const field = page.getByRole("group", { name: NARRATIVE_LABEL });
  const narrative = field.getByRole("textbox", { name: NARRATIVE_LABEL });
  await field.getByRole("button", { name: "Bold", exact: true }).click();
  await narrative.pressSequentially(NARRATIVE);
  await expect(narrative.locator("p > strong")).toHaveText(NARRATIVE);
  await narrative.press("Enter");
  await expect(narrative.locator("p")).toHaveCount(2);
  await field
    .getByRole("button", { name: "Bulleted list", exact: true })
    .click();
  await expect(narrative.locator("ul > li")).toHaveCount(1);
  await narrative.pressSequentially(NEXT_STEP);
  await expect(narrative.locator("ul > li")).toHaveText(NEXT_STEP);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Publish", exact: true })
    .click();

  // The card reads the snapshot: the value it moved from, the value it moved
  // to, and the difference, which is what a reviewer reads first.
  const card = history();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("40 → 60 (+20)");
  // "At risk", §3.5's default label for the stored `caution` (P9-T15b-a).
  await expect(card).toContainText("At risk");
  await expect(card).toContainText("awaiting the reviewer");
  // As it was written, not flattened to a line of text.
  await expect(shownParagraph().locator("strong")).toHaveText(NARRATIVE);
  await expect(shownList()).toHaveText(NEXT_STEP);
  // A list that looks like one: Preflight takes the markers off every list.
  await expect(shownList()).toHaveCSS("list-style-type", "disc");
});

test("correcting the narrative from the timeline keeps its formatting", async () => {
  const card = history();
  const edit = card.getByRole("textbox", { name: "Narrative", exact: true });
  // A click at the far end of the list item's line puts the caret after its
  // last word. Select-all and the right arrow would put it after the list.
  const line = edit.locator("li p");
  const box = await line.boundingBox();
  expect(box, "the list item is not on screen").not.toBeNull();
  await line.click({
    position: { x: (box?.width ?? 0) - 2, y: (box?.height ?? 0) / 2 },
  });
  await edit.pressSequentially(CORRECTION);
  await card.getByRole("button", { name: "Save", exact: true }).click();

  await expect(shownList()).toHaveText(`${NEXT_STEP}${CORRECTION}`, {
    timeout: 15_000,
  });
  await expect(shownParagraph().locator("strong")).toHaveText(NARRATIVE);
});

test("the reviewer acknowledges it, and the card says so", async () => {
  const card = history();
  await card.getByRole("button", { name: "Acknowledge" }).click();
  await expect(card).toContainText("acknowledged", { timeout: 15_000 });
  await expect(card).not.toContainText("awaiting the reviewer");
  await expect(card.getByRole("button", { name: "Acknowledge" })).toHaveCount(
    0,
  );
});

test("a private vote shows only its author's number until the reveal", async () => {
  const panel = page
    .getByRole("main")
    .locator("div")
    .filter({ has: page.getByLabel(`Your confidence in ${KEY_RESULT}`) })
    .last();

  await expect(panel).toContainText("You have not voted yet.");
  await panel.getByLabel(`Your confidence in ${KEY_RESULT}`).fill("0.7");
  await panel.getByRole("button", { name: "Vote", exact: true }).click();

  // Before the reveal the server sends the count and the reader's own vote and
  // nothing else, so what is on the page is all a client could know.
  await expect(panel).toContainText("Your vote: 0.7", { timeout: 15_000 });
  await expect(panel).toContainText("1 vote in");
  await expect(panel.getByRole("button", { name: "Change" })).toBeVisible();
});

test("revealing shows every vote together, and closes the ballot", async () => {
  const card = page
    .getByRole("main")
    .locator("div")
    .filter({ hasText: KEY_RESULT })
    .filter({ has: page.getByRole("button", { name: "Reveal together" }) })
    .last();
  await card.getByRole("button", { name: "Reveal together" }).click();

  const revealed = page
    .getByRole("main")
    .getByText(/^revealed · average 0\.7/);
  await expect(revealed).toBeVisible({ timeout: 15_000 });
  // One write over the whole set, so there is nothing left to vote on.
  await expect(
    page.getByLabel(`Your confidence in ${KEY_RESULT}`),
  ).toHaveCount(0);
});
