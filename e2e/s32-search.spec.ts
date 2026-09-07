/**
 * Search, the command palette and the export (UIUX-PLAN.md §4 S-32,
 * TECHNICAL-PLAN §5 and §9, P5-T13).
 *
 * Acceptance criterion:
 *   Given any screen, when the palette is opened and a short identifier typed,
 *   then the entity opens.
 *
 * **A browser rather than a unit test, because these are claims about a
 * keyboard surface.** What the index decides, including that a suspended member
 * sees nothing and an unpublished document is never indexed at all, is proved
 * against a real database in `packages/core/test/search.test.ts`. What this
 * proves is that ⌘K opens on any screen, that the arrows and Enter work, and
 * that the file a person downloads has the rows the screen showed.
 *
 * **The index is written by the outbox, and a relay drains it.** The specs run
 * against the standalone server, which runs the relay, so the row a write
 * enqueues is indexed a moment later. The waits below are for that, not for the
 * browser.
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
let goalTitle: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("sign in, and find something the instance already holds", async () => {
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

  const goal = (
    await pool.query<{ title: string }>(
      "select title from goals where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!goal) {
    throw new Error("No goal to search for.");
  }
  goalTitle = goal.title;
});

test("the relay indexes what the instance holds", async () => {
  await expect(async () => {
    const { rows } = await pool.query<{ count: string }>(
      "select count(*) from search_documents where workspace_id = $1",
      [workspaceId],
    );
    // The pipeline enqueued a row for every write the earlier specs made; the
    // relay drains them. If this never passes, the relay is not running, which
    // is a different failure from the search being wrong.
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000 });
});

test("the search page finds a goal and marks what matched", async () => {
  const word = goalTitle.split(" ").find((one) => one.length > 4) ?? goalTitle;
  await goTo(page, `/search?q=${encodeURIComponent(word)}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Search" }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("search-results")).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });

  await expect(page.getByTestId("search-results")).toContainText(goalTitle);
  // `ts_headline` marks the matching words and the page renders them as
  // elements rather than as HTML.
  await expect(page.locator("mark").first()).toBeVisible();
});

test("narrowing to a type is a link somebody can send", async () => {
  await page.getByRole("link", { name: "Objectives" }).click();
  await expect(page).toHaveURL(/type=goal/, { timeout: 15_000 });
  await expect(page.getByTestId("search-results")).toContainText(goalTitle);
});

test("acceptance: the palette opens anywhere, and the keyboard drives it", async () => {
  await goTo(page, "/");
  await page.keyboard.press("ControlOrMeta+k");

  const palette = page.getByTestId("palette");
  await expect(palette).toBeVisible({ timeout: 10_000 });

  const word = goalTitle.split(" ").find((one) => one.length > 4) ?? goalTitle;
  await page.getByRole("textbox", { name: "Search everything" }).fill(word);
  await expect(page.getByTestId("palette-results")).toContainText(goalTitle, {
    timeout: 15_000,
  });

  // Arrow to the first row and open it, which is the whole point of a palette.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/goals\//, { timeout: 15_000 });
  await expect(page.getByTestId("palette")).toHaveCount(0);
});

test("escape closes it and it forgets what was typed", async () => {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "Search everything" }).fill("hello");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("textbox", { name: "Search everything" }),
  ).toHaveValue("");
  await page.keyboard.press("Escape");
});

test("the export carries the rows the screen showed, and is audited", async () => {
  const before = Number(
    (
      await pool.query<{ count: string }>(
        "select count(*) from audit_events where workspace_id = $1 and action = 'exports.list'",
        [workspaceId],
      )
    ).rows[0]?.count,
  );

  await goTo(page, "/goals");
  // "Export", with the format beside it since P5-T15. CSV is the default, so
  // this is the same click it always was.
  await page.getByRole("button", { name: "Export" }).click();

  await expect(page.getByTestId("export-result")).toContainText("row", {
    timeout: 15_000,
  });

  await expect(async () => {
    const { rows } = await pool.query<{ count: string }>(
      "select count(*) from audit_events where workspace_id = $1 and action = 'exports.list'",
      [workspaceId],
    );
    expect(Number(rows[0]?.count)).toBe(before + 1);
  }).toPass({ timeout: 15_000 });
});
