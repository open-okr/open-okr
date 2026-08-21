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

  // **Advance until the last stage, rather than exactly twice.**
  //
  // The old loop assumed the session sat two stages from the end, which was
  // true only because the test before it had advanced once. Marking that test
  // `fixme` left this one a stage short and it failed looking for a button the
  // facilitator had not reached. A count that depends on what another test did
  // breaks whenever that test does; §7.2's four steps are the bound, and
  // reaching the end is the condition.
  for (let i = 0; i < WEEKLY_STAGE_COUNT; i += 1) {
    const btn = page.getByRole("button", { name: "Continue to next step" });
    if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      break;
    }
    await btn.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
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
  // **Scoped to the list, not the page.** A bare `getByText` here also matched
  // the textarea the sentence was just typed into, so it went green the moment
  // the click happened rather than when the decision was stored. The
  // navigation that followed then raced a write that had not landed, which is
  // what made the next assertion fail one run in five while the row was
  // plainly in the database a moment later.
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Move two engineers off billing onto activation" }),
  ).toHaveCount(1, { timeout: 10_000 });

  // The criterion: the goal page shows it, with the date and the author.
  //
  // Scoped to the decision's own row. The author's name appears five times on
  // this page (the workspace title, the header, the roles card, a member
  // picker), so a bare `getByText(NAME)` is a strict-mode violation rather
  // than a check that the decision carries an author.
  // Same reason as the quarterly spec below: the review screen this navigation
  // leaves is a running session holding an SSE stream, and it refreshes itself
  // on every event. Waiting for `load` let a superseded navigation resolve
  // against a render that predated the decision, which is what made this
  // assertion fail one run in five while the row was plainly in the database.
  await page.goto(`/goals/${goal.id}`, { waitUntil: "domcontentloaded" });
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
    // **Does a second load show it?** The remaining question after the first
    // diagnostic: the row is in the database and visible to the application
    // role, so either the read returns nothing or the page was served from a
    // render made before the decision existed. A reload separates those two,
    // and the answer decides whether the fix is in the query or in the cache.
    await page.reload();
    const afterReload = await row.count();
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
        `Rows visible after a reload: ${afterReload}`,
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

// ---------------------------------------------------------------------------
// The quarterly review's shell (METHOD.md §8.1, screen S-24, P4-T10a-a)
// ---------------------------------------------------------------------------

/**
 * The acceptance criterion, and the half of the test plan only a browser
 * settles.
 *
 * Given a running review, when the facilitator advances a stage, then every
 * participant's rail moves and the timer restarts. Two contexts, because "every
 * participant" is the whole claim, and a single page proves nothing about the
 * second one.
 *
 * **Half of that criterion is blocked and this test says so rather than
 * pretending.** "Without a reload" needs an event to reach the browser, and
 * nothing drains the outbox. The second client reloads here, which proves the
 * stage change reached the server and that both clients read the same rail from
 * it. The live half is `test.fixme` on P4-T07a's criterion above, and the
 * blocker is recorded in PHASE-4-SPLIT.md.
 *
 * **The private half of the notes line is not driven here, and cannot be.**
 * Both contexts sign in as the same account, because this suite has exactly one
 * instance account by design, so the second browser is the facilitator too.
 * What a participant sees is settled in `packages/core/test/quarterly-shell`
 * against a second member; this proves the facilitator's own note round-trips
 * through the screen.
 */
test("a quarterly review runs its rail, and the second client follows", async ({
  browser,
}) => {
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

  const scope = (
    await pool.query<{ space_id: string; cycle_id: string }>(
      `select space_id, cycle_id from goals
        where workspace_id = $1 and deleted_at is null and cycle_id is not null
        order by position, created_at limit 1`,
      [member.workspace_id],
    )
  ).rows[0];
  if (!scope) throw new Error("No goal to review.");

  const reviewId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local app.workspace_id = '${member.workspace_id}'`);
    await client.query(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          facilitator_id, state)
       values ($1, $2, $3, $4, 'quarterly', 'Q1 review', now(), $5,
               'scheduled')`,
      [
        reviewId,
        member.workspace_id,
        scope.space_id,
        scope.cycle_id,
        member.id,
      ],
    );
    await client.query("commit");
  } finally {
    client.release();
  }

  // `domcontentloaded`, not the default `load`. A running session holds an SSE
  // stream and refreshes itself on every event, which supersedes a pending
  // navigation: this goto failed with `net::ERR_ABORTED` on a page that had
  // rendered perfectly well.
  await page.goto(`/session/${reviewId}`, { waitUntil: "domcontentloaded" });

  // The rail before anything starts: eleven stages under their four acts, and
  // no weekly step in sight.
  await expect(page.getByText("Open and check-in")).toBeVisible();
  await expect(page.getByText("Decisions and actions")).toBeVisible();
  await expect(page.getByText("Confidence round")).toBeHidden();
  // Scoped to the rail: "Open", "Review" and "Reset" are single words that
  // appear in the navigation and the page title as well.
  const rail = page.getByRole("region").filter({ hasText: "Stages" });
  for (const act of ["Open", "Review", "Retro", "Reset"]) {
    await expect(rail.getByText(act, { exact: true })).toHaveCount(1);
  }

  // **The second client joins before the review opens, not after.**
  //
  // That is the real order of a session: people arrive, then the facilitator
  // starts. It is also the only order that works here. Navigating onto a
  // session that is already running means landing on a page that opens an SSE
  // stream and refreshes itself the moment it connects, and that refresh
  // cancels the navigation: every `waitUntil` setting reported
  // `net::ERR_ABORTED` for a page whose own snapshot showed it had rendered.
  // Joining while the session is still scheduled has nothing to race.
  // **The session is carried over, not signed in again.**
  //
  // Signing in through the form leaves a client navigation in flight, and it
  // cancels whatever navigation comes next: `secondPage.goto` reported
  // `net::ERR_ABORTED` under every `waitUntil` setting and with a landmark
  // wait in between, on a page that had rendered nothing yet. Reusing the
  // storage state gives a second logged-in client with no navigation to race,
  // which is what `registration-to-dashboard.spec.ts` already does for its own
  // second context.
  const second = await browser.newContext({
    storageState: await context.storageState(),
  });
  const secondPage = await second.newPage();
  await secondPage.goto(`/session/${reviewId}`);
  await expect(secondPage.getByText("Not started")).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText(/Stage 1 of 11/)).toBeVisible({
    timeout: 10_000,
  });
  // **Not asserted live.** Opening is a stage change and the second client
  // should follow without touching anything, and it will not until a relay
  // drains the outbox row `sessions.open` now writes. A reload is what proves
  // the server moved, which is the honest claim this test can make today.
  await secondPage.reload();
  await expect(secondPage.getByText(/Stage 1 of 11/)).toBeVisible({
    timeout: 10_000,
  });

  // Stage one's own content: the pulse, and the read only the facilitator gets
  // (METHOD.md section 8.2, P4-T10a-b).
  await expect(page.getByText("Your pulse")).toBeVisible();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByLabel("One word for the cycle").fill("relieved");
  await page.getByRole("button", { name: "Give my pulse" }).click();

  const room = page.getByRole("region").filter({ hasText: "The room" });
  await expect(room).toHaveCount(1, { timeout: 10_000 });
  // The average and section 8.2's own sentence for its band. Four is the top of
  // the energetic band, inclusive, which is the boundary most likely to be
  // written the wrong way round.
  await expect(room).toContainText("4.0 of 5");
  await expect(room).toContainText("The room has energy");
  await expect(room).toContainText("relieved");

  // The private note, written and read back by the facilitator.
  await page
    .getByLabel("Private note for Open and check-in")
    .fill("Pulse was low. Name it before scoring.");
  await page.getByRole("button", { name: "Save the note" }).click();
  await expect(page.getByText("Pulse was low. Name it before scoring.")).toBeVisible({
    timeout: 10_000,
  });

  // Add a minute: stage one's budget moves from 5 to 6 and nothing else does.
  await expect(page.getByText(/of 5:00/)).toBeVisible();
  await page.getByRole("button", { name: "+ 1 min" }).click();
  await expect(page.getByText(/of 6:00/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Continue to next step" }).click();
  await page.waitForLoadState("networkidle");

  // The second client's rail moves and its timer restarts on stage two's own
  // twelve minutes rather than continuing stage one's six. Reloaded, for the
  // reason above: what this proves is that the stage change reached the server
  // and that both clients read the same rail from it.
  await secondPage.reload();
  await expect(secondPage.getByText(/Stage 2 of 11/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(secondPage.getByText(/of 12:00/)).toBeVisible();

  await second.close();
});
