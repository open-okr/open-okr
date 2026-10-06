/**
 * The monthly review's moves (P9-T19a-d-d, METHOD.md §7.5 and §2.9).
 *
 * Acceptance:
 *   Given a monthly review, when an objective is stopped from it, then the
 *   stop carries its reason as §2.9 says and the review's record names it.
 *
 * The objective is made through the API in the first space and the current
 * quarter, and the review is written straight into its running state, because
 * opening one has its own spec. Both are deleted afterwards, so the space is
 * as the specs after this one expect it.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const OBJECTIVE = `Partners resell the starter plan ${STAMP}`;
const REASON = "The reseller programme was cancelled at the board meeting";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let goalId = "";
let sessionId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (sessionId) {
    await pool.query(
      "update okr_sessions set deleted_at = now() where id = $1",
      [sessionId],
    );
  }
  if (token && goalId) {
    await api.post("/api/v1/goals/delete", {
      headers: authed(),
      data: { id: goalId },
    });
  }
  await api?.dispose();
  await pool?.end();
  await context?.close();
});

test("sign in, with an objective in a running monthly review", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Monthly moves e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
         from workspace_members m join users u on u.id = m.user_id
        where u.email = $1 limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  const space = (
    await pool.query<{ id: string }>(
      "select id from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [member.workspace_id],
    )
  ).rows[0];
  if (!space) {
    throw new Error("No space to hold the review.");
  }
  const cycle = (
    await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()
  ).data as { id: string };

  const created = await api.post("/api/v1/goals/create", {
    headers: authed(),
    data: {
      title: OBJECTIVE,
      cycleId: cycle.id,
      spaceId: space.id,
      level: "team",
      ownerKind: "space",
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  goalId = ((await created.json()).data as { id: string }).id;

  // `okr_sessions`, not `sessions`: Better Auth owns that name.
  sessionId = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          facilitator_id, state, started_at)
       values (gen_random_uuid(), $1, $2, $3, 'monthly', 'Monthly moves QA',
               now(), $4, 'running', now())
       returning id`,
      [member.workspace_id, space.id, cycle.id, member.id],
    )
  ).rows[0]?.id as string;
});

test("acceptance: a stop made from the review carries its reason and the record names it", async () => {
  await goTo(page, `/session/${sessionId}`);
  const moves = page.getByTestId("monthly-moves");
  await expect(moves).toBeVisible({ timeout: 15_000 });
  await expect(moves).toContainText("Continue, update, start or stop");

  // Nothing is chosen to begin with, so the stop cannot be pressed.
  const stop = moves.getByRole("button", { name: "Stop the objective" });
  await expect(stop).toBeDisabled();

  await moves.getByLabel("Objective to stop").selectOption({ label: OBJECTIVE });
  await expect(stop).toBeDisabled();
  await moves.getByLabel("Why it no longer matters").fill(REASON);
  await stop.click();

  const named = moves.getByRole("listitem").filter({ hasText: OBJECTIVE });
  await expect(named).toContainText(REASON, { timeout: 15_000 });
  await expect(named).toContainText("Stopped");

  // §2.9: "Closed as abandoned with a one-line reason".
  const closed = (
    await pool.query<{
      success_status: string;
      close_decision: string;
      close_reason: string;
    }>(
      "select success_status, close_decision, close_reason from goals where id = $1",
      [goalId],
    )
  ).rows[0];
  expect(closed).toEqual({
    success_status: "abandoned",
    close_decision: "abandon",
    close_reason: REASON,
  });

  // A stopped objective has nowhere to go, so the review asks no trend of it
  // and offers it to nobody to stop twice.
  await expect(
    moves.getByLabel("Objective to stop").locator("option", {
      hasText: OBJECTIVE,
    }),
  ).toHaveCount(0);
});
