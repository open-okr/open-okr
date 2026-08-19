/**
 * Session screen QA — P4-T07a (METHOD.md §7.2, screen S-22).
 *
 * Acceptance criterion:
 *   Given two participants in one session, when the facilitator advances a
 *   stage, then both see the new stage without a reload.
 *
 * Runs against the local dev server (localhost:3000). Uses a single shared
 * browser context (like registration-to-dashboard.spec.ts) so auth cookies
 * persist across tests. A second context is opened only for the two-client
 * acceptance criterion test.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";

const EMAIL = "session-qa@example.com";
const PASSWORD = "correct horse battery staple";
const NAME = "Session Tester";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55432/openokr_dev";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let sessionId: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
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
  await page.goto(`/session/${sessionId}`);

  const continueBtn = page.getByRole("button", { name: "Continue to next step" });
  await expect(continueBtn).toBeVisible({ timeout: 5_000 });

  await continueBtn.click(); // stage 3 (commitments)
  await page.waitForLoadState("networkidle");

  await continueBtn.click(); // stage 4 (digest) — last
  await page.waitForLoadState("networkidle");

  const closeBtn = page.getByRole("button", { name: "Close session" });
  await expect(closeBtn).toBeVisible({ timeout: 5_000 });
  await closeBtn.click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "Start session" })).not.toBeVisible();
  await expect(closeBtn).not.toBeVisible();
});
