/**
 * A next action for every low score (P9-T19a-b, METHOD.md §7.2 step 2).
 *
 * Acceptance:
 *   Given a key result scored low with nothing blocking it, when the team
 *   names a next action and its owner, then the session moves on without a
 *   blocker, and the action is due by the next check-in.
 *
 * The session is written straight into step 2 with the key result already
 * confirmed at 0.3, because the confidence round has its own spec and this
 * one is about what step 2 asks for. The objective is made through the API
 * and deleted afterwards, and the session is deleted with it, so the space is
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
const OBJECTIVE = `New accounts reach value in a week ${STAMP}`;
const KEY_RESULT = `Guided setup completion 40% to 60% ${STAMP}`;
const NEXT_ACTION = "Mei confirms the new import date on Thursday";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let goalId = "";
let keyResultId = "";
let sessionId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

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

test("sign in, with a key result confirmed low in a session at step 2", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Next action e2e");
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
  const cycle = (
    await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()
  ).data as { id: string };
  if (!space) {
    throw new Error("No space to hold the session.");
  }

  goalId = (
    await post<{ id: string }>("goals.create", {
      title: OBJECTIVE,
      cycleId: cycle.id,
      spaceId: space.id,
      level: "team",
      ownerKind: "space",
    })
  ).id;
  keyResultId = (
    await post<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: KEY_RESULT,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 40,
      targetValue: 60,
      reason: "Added for the next-action spec",
    })
  ).id;

  // `okr_sessions`, not `sessions`: Better Auth owns that name.
  sessionId = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          facilitator_id, state, stage_key)
       values (gen_random_uuid(), $1, $2, $3, 'weekly', 'Next action QA',
               now() - interval '1 hour', $4, 'running', 'diagnose')
       returning id`,
      [member.workspace_id, space.id, cycle.id, member.id],
    )
  ).rows[0]?.id as string;
  await pool.query(
    `insert into session_participants (id, workspace_id, session_id, member_id)
     values (gen_random_uuid(), $1, $2, $3)`,
    [member.workspace_id, sessionId, member.id],
  );
  await pool.query(
    `insert into session_confidences
       (id, workspace_id, session_id, key_result_id, confirmed_confidence,
        what_changed, confirmed_by_id)
     values (gen_random_uuid(), $1, $2, $3, 0.3, 'Bulk import slipped two weeks', $4)`,
    [member.workspace_id, sessionId, keyResultId, member.id],
  );
});

test("acceptance: a next action and its owner move the session on with no blocker", async () => {
  await goTo(page, `/session/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "What dropped" }),
  ).toBeVisible({ timeout: 15_000 });
  const row = page.getByTestId("low-score").filter({ hasText: KEY_RESULT });
  await expect(row).toBeVisible();

  await row
    .getByLabel("The next action", { exact: true })
    .fill(NEXT_ACTION);
  await row
    .getByLabel("Who owns it", { exact: true })
    .selectOption({ index: 1 });
  await row.getByRole("button", { name: "Set it" }).click();

  await expect(row).toContainText(NEXT_ACTION, { timeout: 15_000 });
  await expect(row).toContainText("due by");

  const scores = (
    await (
      await api.get(`/api/v1/sessions/lowScores?sessionId=${sessionId}`, {
        headers: authed(),
      })
    ).json()
  ).data as {
    keyResultId: string;
    low: boolean;
    blocked: boolean;
    nextAction: { text: string; dueOn: string } | null;
  }[];
  const scored = scores.find((one) => one.keyResultId === keyResultId);
  expect(scored).toMatchObject({
    low: true,
    blocked: false,
    nextAction: { text: NEXT_ACTION },
  });

  // Moves on with no blocker raised.
  await page.getByRole("button", { name: "Continue to next step" }).click();
  await expect(page.locator('li[aria-current="step"]')).toContainText(
    "Commitments",
    { timeout: 15_000 },
  );
  const { rows } = await pool.query(
    "select id from blockers where session_id = $1",
    [sessionId],
  );
  expect(rows).toEqual([]);
});
