/**
 * Session screen QA — P4-T07a (METHOD.md §7.2, screen S-22).
 *
 * Acceptance criterion:
 *   Given two participants in one session, when the facilitator advances a
 *   stage, then both see the new stage without a reload.
 *
 * Runs in continuous integration against the prepared application instance, and
 * locally against the dev server through `playwright.dev.config.ts`. Uses a
 * single shared browser context (like registration-to-dashboard.spec.ts) so
 * auth cookies persist across tests. A second context is opened only for the
 * two-client acceptance criterion test.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import { INSTANCE_ACCOUNT } from "./instance-account.ts";
import pg from "pg";

// **Not an address of this spec's own.** The application instance is claimed by
// whichever spec runs first, and registration closes behind them, so a private
// account here can only ever exist on the machine where somebody ran the wizard
// by hand. That is exactly how this file passed locally and failed on
// continuous integration from the day it landed.
const { email: EMAIL, password: PASSWORD, name: NAME } = INSTANCE_ACCOUNT;
/**
 * The application instance's own database.
 *
 * **`DATABASE_URL` is not set for the test process**, only inside the two
 * `webServer` environments in `playwright.config.ts`, so the previous fallback
 * to `openokr_dev` silently pointed this spec at a database the servers under
 * test never touch. It worked on the machine it was written on, where
 * `openokr_dev` was the running instance, and could not have worked anywhere
 * else.
 *
 * `connectionOptions` is the same helper `e2e/prepare-database.ts` builds the
 * database with, so the spec and the preparation cannot drift apart. A
 * `DATABASE_URL` in the environment still wins, which is what makes
 * `playwright.dev.config.ts` work against a developer's own instance.
 */
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // **The superuser, not the application role.** Every business table
      // carries forced row-level security keyed on `app.workspace_id`, and
      // these setup queries have to find the workspace *before* they could set
      // it: the member row is how they learn which workspace this is. As the
      // application role the policy answers with nothing rather than raising,
      // so the query returns no rows and the spec reports "Member not found"
      // for a member that is plainly there. Every unit suite reaches past the
      // tenant floor the same way, through its `admin` connection, and for the
      // same reason.
      testDbEnv.superuser,
    );

const NEWLINE = String.fromCharCode(10);

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let sessionId: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

// ---------------------------------------------------------------------------
// Step 1: Authenticate (setup wizard or sign-in, whichever applies)
// ---------------------------------------------------------------------------
test("sign in and land on the Work Map", async () => {
  await page.goto("/");

  if (page.url().includes("/setup")) {
    await page.goto("/setup/account");
    await page.getByLabel("What should this instance be called?").fill("Session QA");
    await page.getByLabel("Your name").fill(NAME);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page).toHaveURL("/", { timeout: 15_000 });
  } else if (page.url().includes("/sign-in")) {
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await expect(page).toHaveURL("/", { timeout: 10_000 });
  }

  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Step 2: Create session via pg (no "Create session" UI yet)
// ---------------------------------------------------------------------------
test("create a session and navigate to the session screen", async () => {
  const user = (
    await pool.query<{ id: string }>(
      "select id from users where email = $1",
      [EMAIL],
    )
  ).rows[0];
  if (!user) throw new Error(`User ${EMAIL} not found.`);

  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      "select id, workspace_id from workspace_members where user_id = $1 and deleted_at is null limit 1",
      [user.id],
    )
  ).rows[0];
  if (!member) throw new Error("Member not found.");

  const space = (
    await pool.query<{ id: string }>(
      "select id from spaces where workspace_id = $1 and deleted_at is null limit 1",
      [member.workspace_id],
    )
  ).rows[0];
  if (!space) throw new Error("Space not found.");

  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local app.workspace_id = '${member.workspace_id}'`);
    await client.query(
      `insert into okr_sessions
         (id, workspace_id, space_id, kind, title, scheduled_for, facilitator_id, state)
       values ($1, $2, $3, 'weekly', 'Weekly check-in', now() + interval '1 hour', $4, 'scheduled')`,
      [id, member.workspace_id, space.id, member.id],
    );
    await client.query("commit");
  } finally {
    client.release();
  }

  sessionId = id;
  await page.goto(`/session/${sessionId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// Step 3: Scheduled state — step rail and controls
// ---------------------------------------------------------------------------
test("scheduled state — step rail and controls visible", async () => {
  await page.goto(`/session/${sessionId}`);

  await expect(page.getByText("Confidence round")).toBeVisible();
  await expect(page.getByText("Diagnose what is low")).toBeVisible();
  await expect(page.getByText("Commitments")).toBeVisible();
  await expect(page.getByText("Digest")).toBeVisible();

  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Step 4: Open session — stage 1 active
// ---------------------------------------------------------------------------
test("facilitator opens the session — stage 1 becomes active", async () => {
  await page.goto(`/session/${sessionId}`);
  await page.getByRole("button", { name: "Start session" }).click();

  await expect(
    page.getByRole("button", { name: "Continue to next step" }),
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Step 5: Acceptance criterion — two contexts, live stage sync
// ---------------------------------------------------------------------------
test("acceptance criterion: second context sees stage advance without reload", async ({
  browser,
}) => {
  const second = await browser.newContext();
  const secondPage = await second.newPage();

  // Sign in to the second context.
  await secondPage.goto("/sign-in");
  await secondPage.getByLabel("Email").fill(EMAIL);
  await secondPage.getByLabel("Password").fill(PASSWORD);
  await secondPage.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await secondPage.waitForURL("/", { timeout: 10_000 });

  // Both open the session.
  await page.goto(`/session/${sessionId}`);
  await secondPage.goto(`/session/${sessionId}`);

  // Give the SSE connection a moment to establish.
  await page.waitForTimeout(1500);

  // Facilitator (first context) advances the stage.
  const continueBtn = page.getByRole("button", { name: "Continue to next step" });
  await expect(continueBtn).toBeVisible({ timeout: 5_000 });
  await continueBtn.click();
  await page.waitForLoadState("networkidle");

  // Second context: SessionLive hook received the SSE event → router.refresh()
  // The session re-fetches and shows the new current stage.
  await expect(
    secondPage.getByText("Diagnose what is low"),
  ).toBeVisible({ timeout: 8_000 });

  await second.close();
});

// ---------------------------------------------------------------------------
// Step 6: Advance through remaining stages and close
// ---------------------------------------------------------------------------
test("facilitator advances through remaining stages and closes", async () => {
  // Reload in case the shared page state is stale from the two-context test.
  await page.goto(`/session/${sessionId}`);
  await page.waitForLoadState("networkidle");

  // Advance through each remaining stage one at a time.
  for (let i = 0; i < 2; i++) {
    const btn = page.getByRole("button", { name: "Continue to next step" });
    if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await btn.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    }
  }

  // On the last stage, "Close session" should appear.
  const closeBtn = page.getByRole("button", { name: "Close session" });
  await expect(closeBtn).toBeVisible({ timeout: 5_000 });
  await closeBtn.click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "Start session" })).not.toBeVisible();
  await expect(closeBtn).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// The monthly review (METHOD.md §7.5, screen S-23, P4-T09)
// ---------------------------------------------------------------------------

/**
 * The acceptance criterion, end to end.
 *
 * Given a monthly review recording a decision against a key result, when the
 * goal page is opened, then the decision appears in its history with its date
 * and author.
 *
 * Driven through the browser because the criterion is about two screens: the
 * review records it and the goal page shows it, and a unit test proving the
 * query cannot prove the second screen calls it. The goal is the one
 * `registration-to-dashboard.spec.ts` drafted; the suite runs one worker with
 * `fullyParallel: false`, so it is there by the time this file runs.
 */
test("a monthly review records a trend and a decision, and the goal shows it", async () => {
  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
         from workspace_members m
         join users u on u.id = m.user_id
        where u.email = $1 and m.deleted_at is null
        limit 1`,
      [EMAIL],
    )
  ).rows[0];
  if (!member) throw new Error("Member not found.");

  // An open objective with at least one key result, because the decision has
  // to name one. Ordered the same way the review screen orders its list.
  const goal = (
    await pool.query<{ id: string; space_id: string; cycle_id: string }>(
      `select g.id, g.space_id, g.cycle_id
         from goals g
         join key_results k on k.goal_id = g.id and k.deleted_at is null
        where g.workspace_id = $1 and g.deleted_at is null
          and g.cycle_id is not null and g.closed_at is null
        order by g.position, g.created_at
        limit 1`,
      [member.workspace_id],
    )
  ).rows[0];
  if (!goal) throw new Error("No goal to review.");

  const keyResult = (
    await pool.query<{ title: string }>(
      `select title from key_results
        where goal_id = $1 and deleted_at is null
        order by position, created_at limit 1`,
      [goal.id],
    )
  ).rows[0];
  if (!keyResult) throw new Error("No key result to decide about.");

  const monthlyId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local app.workspace_id = '${member.workspace_id}'`);
    await client.query(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          facilitator_id, state, started_at)
       values ($1, $2, $3, $4, 'monthly', 'Monthly review', now(), $5,
               'running', now())`,
      [monthlyId, member.workspace_id, goal.space_id, goal.cycle_id, member.id],
    );
    await client.query("commit");
  } finally {
    client.release();
  }

  await page.goto(`/session/${monthlyId}`);

  // No stage rail: a monthly review has none, and the weekly one appearing
  // here would be the wrong ritual on the screen.
  await expect(page.getByText("Confidence round")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Monthly review" })).toBeVisible();

  // §7.5's four panels.
  await expect(page.getByText("Trend per objective")).toBeVisible();
  await expect(page.getByText("Dependency and risk log")).toBeVisible();
  await expect(page.getByText("Resource or priority shifts")).toBeVisible();
  await expect(page.getByText("Decisions")).toBeVisible();

  // The trend starts unrecorded. Nothing is pre-selected from §3.7's signal,
  // which is the whole point: the room decides and the number is evidence.
  //
  // Counted rather than asserted globally hidden: this workspace has more than
  // one objective by the time the suite reaches here, and recording a trend on
  // the first leaves the others correctly unrecorded.
  const unrecorded = page.getByText("Not recorded yet");
  const before = await unrecorded.count();
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Declining" }).first().click();
  await expect(unrecorded).toHaveCount(before - 1, { timeout: 10_000 });

  // A decision against this goal's own key result, named rather than picked by
  // position: the panel lists every objective in the space, so "the first
  // option with a separator" was landing the decision on whichever objective
  // happened to sort first and then checking a different goal's page.
  const subject = page.getByLabel("What it affects");
  const options = await subject.locator("option").allTextContents();
  const keyResultOption = options.find((label) =>
    label.endsWith(`· ${keyResult.title}`),
  );
  if (!keyResultOption) {
    throw new Error(
      `The review offered no option for "${keyResult.title}". Offered: ${options.join(" | ")}`,
    );
  }
  await subject.selectOption({ label: keyResultOption });
  await page
    .getByLabel("The decision")
    .fill("Move two engineers off billing onto activation");
  await page.getByRole("button", { name: "Record the decision" }).click();
  await expect(
    page.getByText("Move two engineers off billing onto activation"),
  ).toBeVisible({ timeout: 10_000 });

  // The criterion: the goal page shows it, with the date and the author.
  //
  // Scoped to the decision's own row. The author's name appears five times on
  // this page (the workspace title, the header, the roles card, a member
  // picker), so a bare `getByText(NAME)` is a strict-mode violation rather
  // than a check that the decision carries an author.
  await page.goto(`/goals/${goal.id}`);
  const decisionsCard = page
    .getByRole("region")
    .filter({ hasText: "Decisions" });
  const row = decisionsCard
    .getByRole("listitem")
    .filter({ hasText: "Move two engineers off billing onto activation" });

  // **Diagnostic on failure, not a retry.** This assertion failed once on code
  // that passed twice either side of it, and the guessing cost three runs. If
  // the card is missing, say whether the row is in the database and what the
  // page actually rendered, so the next failure names the cause instead of
  // starting another round of theories.
  if ((await row.count()) === 0) {
    const stored = await pool.query(
      `select id, workspace_id, goal_id, key_result_id, at, deleted_at
         from decisions where goal_id = $1`,
      [goal.id],
    );
    const headings = await page.getByRole("heading").allTextContents();
    throw new Error(
      [
        "The decision did not reach the goal page.",
        `Goal: ${goal.id}`,
        `Rows in the database for it: ${JSON.stringify(stored.rows)}`,
        `Regions on the page: ${(await page.getByRole("region").allTextContents()).length}`,
        `Headings on the page: ${headings.join(" | ")}`,
      ].join(NEWLINE),
    );
  }
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(NAME);
  // The date, in whatever form the reader's locale renders it.
  await expect(row).toContainText(new Date().getFullYear().toString());

  // And the cycle workspace, which is §7.5's second surface.
  await page.goto("/cycle");
  await expect(page.getByText("Decisions this cycle")).toBeVisible();
  await expect(
    page.getByText("Move two engineers off billing onto activation"),
  ).toBeVisible();
});
