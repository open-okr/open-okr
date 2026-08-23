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

/** §7.2's four weekly steps, as the bound on "advance until the end". */
const WEEKLY_STAGE_COUNT = 4;

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
/**
 * **This test could not fail, and it is marked so rather than left green.**
 *
 * It asserted that the second client shows "Diagnose what is low" after the
 * advance. That is a weekly step title, and the rail renders all four titles at
 * every stage, so the assertion held before the advance as well as after it.
 * P4-T07a's acceptance criterion was never actually proven.
 *
 * The criterion is also not satisfiable today, which is the more important
 * half. Nothing published `session.stageChanged`: the event was declared in
 * `packages/core/src/sessions/live.ts`, listened for by `use-session-live` and
 * forwarded by the SSE route, and emitted by no code. P4-T10a-a adds the outbox
 * rows `sessions.open` and `sessions.advanceStage` should always have written,
 * so the write path is complete and correct now. Nothing drains the outbox yet,
 * so no event reaches a browser.
 *
 * `fixme` keeps the claim visible and unmistakably unproven. Remove it when a
 * relay host exists; the gap is recorded in PHASE-4-SPLIT.md.
 */
test.fixme("acceptance criterion: second context sees stage advance without reload", async ({
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

  // **Advance until the last stage, and never mistake "still loading" for
  // "reached the end".**
  //
  // Two versions of this loop were wrong for two different reasons. The first
  // advanced exactly twice, which was correct only because the test before it
  // advanced once: marking that one `fixme` left this a stage short. The second
  // broke out whenever the Continue button was not visible within three
  // seconds, which is true at the end of the rail *and* while a click's
  // navigation is still settling, so it stopped mid-rail about one run in three.
  //
  // Waiting for either button distinguishes the two. Continue means keep going,
  // Close means the rail is done, and neither being there yet means wait.
  const continueBtn = page.getByRole("button", {
    name: "Continue to next step",
  });
  const closeBtn = page.getByRole("button", { name: "Close session" });
  // Each click is retried against whatever node is current, for the same reason
  // the close below is: the page replaces its own buttons on every stream event,
  // so a click can land on a node that is already gone. A click that quietly
  // failed left the loop short of the rail's end and the close button never
  // appeared.
  for (let i = 0; i < WEEKLY_STAGE_COUNT * 3; i += 1) {
    if (await closeBtn.isVisible().catch(() => false)) {
      break;
    }
    if (!(await continueBtn.isVisible().catch(() => false))) {
      // Neither button is there yet, which means the page is mid-refresh. That
      // is a third state, and treating it as "reached the end" is what left
      // earlier versions of this loop stranded in the middle of the rail.
      await page.waitForTimeout(500);
      continue;
    }
    await expect(async () => {
      await continueBtn.click({ timeout: 4_000 });
    }).toPass({ timeout: 12_000 });
  }

  // On the last stage, "Close session" should appear.
  await expect(closeBtn).toBeVisible({ timeout: 10_000 });

  // **Retried on the outcome, not on the click.**
  //
  // A running session holds an SSE stream and calls `router.refresh()` on every
  // event, so the button node is detached and re-created underneath a click:
  // Playwright reported "element is not stable", then "element was detached from
  // the DOM". `networkidle` is no help, because an open event stream never goes
  // idle.
  //
  // Retrying the click alone was wrong, and the failure said so: once a click
  // lands the button is gone, and the retry then spent its whole window waiting
  // for a button that had done its job. The condition worth waiting for is that
  // the session is closed, which is true whether this attempt clicked it or an
  // earlier one did.
  await expect(async () => {
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ timeout: 5_000 });
    }
    await expect(closeBtn).toBeHidden({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  await expect(page.getByRole("button", { name: "Start session" })).not.toBeVisible();
  await expect(closeBtn).not.toBeVisible();
});
