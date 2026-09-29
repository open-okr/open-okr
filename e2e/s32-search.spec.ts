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
 * **The palette's groups since completeness review M-21:** Go to, the search
 * results, Related when an AI provider is on, and Actions. What each read
 * offers a guest or a reader outside a space is proved in
 * `packages/core/test/search-palette.test.ts`, and the keyboard in jsdom in
 * `apps/web/test/command-palette.test.tsx`.
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

/**
 * Opens the palette, retrying the keystroke rather than the assertion (P8-T15).
 *
 * **The shortcut is registered at hydration, and a keypress before that goes
 * nowhere.** Nothing is listening yet, so the key is delivered to the document
 * and discarded, and an assertion afterwards waits ten seconds for a palette
 * that was never asked to open. Waiting longer cannot help: the press has
 * already happened and there is nothing to arrive.
 *
 * Same shape as the quiet-hours fix in `s36-channels`, and the same reasoning:
 * when a race is lost at the moment of the interaction, the interaction is what
 * has to be retried.
 *
 * Found on 18 September 2026 by the flakiness report P8-T15 added, on run six
 * of ten. Before that report existed this failed, was retried by continuous
 * integration, passed, and left no record.
 */
async function openPalette() {
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Presses the down arrow until the row the palette has active holds this text,
 * which is how a keyboard user reaches a row that is not first (M-21).
 *
 * The palette now lists a phrase's matches under Go to, then the search
 * results, then the actions, so the row a spec wants is not always the first
 * one. Fails rather than pressing Enter on whichever row it stopped at.
 */
async function arrowTo(text: string) {
  const active = page.locator('[role="option"][aria-selected="true"]');
  for (let presses = 0; presses < 40; presses += 1) {
    if (((await active.textContent()) ?? "").includes(text)) {
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`No palette row holds "${text}".`);
}

const paletteInput = () =>
  page.getByRole("combobox", { name: "Search everything" });

test("acceptance: the palette opens anywhere, and the keyboard drives it", async () => {
  await goTo(page, "/");
  await openPalette();

  const word = goalTitle.split(" ").find((one) => one.length > 4) ?? goalTitle;
  await paletteInput().fill(word);
  await expect(page.getByTestId("palette-results")).toContainText(goalTitle, {
    timeout: 15_000,
  });

  // Arrow to the goal's row and open it, which is the whole point of a
  // palette.
  await arrowTo(goalTitle);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/goals\//, { timeout: 15_000 });
  await expect(page.getByTestId("palette")).toHaveCount(0);
});

test("acceptance: a short identifier opens the KPI it names", async () => {
  const kpi = (
    await pool.query<{ id: string; short_id: string; title: string }>(
      `select id, short_id, title from kpis
        where workspace_id = $1 and deleted_at is null
        order by created_at limit 1`,
      [workspaceId],
    )
  ).rows[0];
  test.skip(!kpi, "No KPI in this instance to jump to.");
  if (!kpi) {
    return;
  }

  await goTo(page, "/");
  await openPalette();
  await paletteInput().fill(kpi.short_id);
  // The code's own answer is the first row under Go to.
  await expect(page.getByTestId("palette-group-goTo")).toContainText(
    kpi.title,
    { timeout: 15_000 },
  );
  await arrowTo(kpi.title);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/kpis/${kpi.id}`), {
    timeout: 15_000,
  });
});

test("the jump finds a name before the last letter is typed", async () => {
  await goTo(page, "/");
  await openPalette();

  // Full text wants whole words, so this is a phrase only the jump by name
  // can answer (completeness review M-21). Before it, the palette found a KPI
  // by its code and nothing else by the start of a name.
  await paletteInput().fill(goalTitle.slice(0, -1));
  await expect(page.getByTestId("palette-group-goTo")).toContainText(
    goalTitle,
    { timeout: 15_000 },
  );

  // With no AI provider there is no Related group, and nothing says AI.
  await expect(page.getByTestId("palette-group-related")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("before a word is typed the palette offers its actions, and one opens a page", async () => {
  await goTo(page, "/");
  await openPalette();

  const actions = page.getByTestId("palette-group-actions");
  await expect(actions).toBeVisible();
  await expect(actions).toContainText("Scorecard");

  // Typing narrows the actions to the ones whose name holds every word.
  await paletteInput().fill("where to reach");
  await expect(actions).toContainText("Where to reach you", {
    timeout: 15_000,
  });
  await arrowTo("Where to reach you");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account\/channels/, { timeout: 15_000 });
  await expect(page.getByTestId("palette")).toHaveCount(0);
});

test("escape closes it and it forgets what was typed", async () => {
  await openPalette();
  await paletteInput().fill("hello");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);

  await openPalette();
  await expect(paletteInput()).toHaveValue("");
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
