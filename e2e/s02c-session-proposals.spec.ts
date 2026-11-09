/**
 * The Champion proposes opening and skipping a weekly session, and the
 * facilitator decides it on the review screen (plan 0.7.0 A13,
 * docs/design/sessions.md §2.1).
 *
 * Acceptance criteria:
 *   Given a weekly session whose scheduled start has passed, when the
 *   Champion's session lifecycle run executes, then its facilitator's review
 *   inbox offers to open it, and applying that opens it in their name.
 *   Given a weekly session nobody opened the day before, when the same run
 *   executes, then the inbox offers to mark it skipped, and applying that
 *   skips it.
 *
 * **The sessions are written with SQL**, for the reason `s42b` records for its
 * KPI: `sessions.create` books in the workspace's calendar and the Champion's
 * windows are an hour and a day wide, so a browser cannot put a session where
 * the run will find it. The run itself is the administrator's "Session
 * lifecycle" button, the same `agents.runChampion` the scheduler calls, and
 * the proposals are the Champion's own, which is what only a server can show.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
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

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;

/** Unique per run, so a second run on the same database finds its own rows. */
const suffix = Math.random().toString(36).slice(2, 8);
const DUE_TITLE = `A13 weekly check-in ${suffix}`;
const MISSED_TITLE = `A13 missed check-in ${suffix}`;
let dueSessionId = "";
let missedSessionId = "";

/** A weekly session in the first space, run by the instance's founder. */
async function weeklySession(title: string, hoursAgo: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into okr_sessions
       (id, workspace_id, space_id, kind, title, scheduled_for,
        facilitator_id, state)
     select gen_random_uuid(), m.workspace_id,
            (select s.id from spaces s
              where s.workspace_id = m.workspace_id and s.deleted_at is null
              order by s.created_at limit 1),
            'weekly', $2, now() - ($3 || ' hours')::interval, m.id, 'scheduled'
       from workspace_members m
       join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null
      limit 1
     returning id`,
    [INSTANCE_ACCOUNT.email, title, String(hoursAgo)],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("The session was not written.");
  }
  return id;
}

const stateOf = async (sessionId: string) =>
  (
    await pool.query<{ state: string }>(
      "select state from okr_sessions where id = $1",
      [sessionId],
    )
  ).rows[0]?.state;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("the session lifecycle run proposes opening a session whose time has come, and skipping one nobody opened", async () => {
  // Half an hour past its start: `session.open`'s window. A day and a half:
  // `session.missed`'s.
  dueSessionId = await weeklySession(DUE_TITLE, 0.5);
  missedSessionId = await weeklySession(MISSED_TITLE, 36);

  await signIn(page);
  await goTo(page, "/admin/agents");
  await page.getByRole("button", { name: "Session lifecycle" }).click();

  await expect(async () => {
    await goTo(page, "/review");
    await expect(
      page.getByText(`Open the session "${DUE_TITLE}"`),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(
    page.getByText(`Mark the session "${MISSED_TITLE}" as skipped`),
  ).toBeVisible();

  // The Champion proposed; it moved nothing.
  expect(await stateOf(dueSessionId)).toBe("scheduled");
  expect(await stateOf(missedSessionId)).toBe("scheduled");
});

test("applying the open proposal opens the session in the facilitator's name", async () => {
  const card = page
    .locator('[id^="proposal-"]')
    .filter({ hasText: `Open the session "${DUE_TITLE}"` });
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });

  expect(await stateOf(dueSessionId)).toBe("running");
  const { rows } = await pool.query<{ status: string; decider: string }>(
    `select p.status, u.email as decider
       from proposed_changes p
       join workspace_members m on m.id = p.decided_by_member_id
       join users u on u.id = m.user_id
      where p.subject_id = $1 and p.action = 'sessions.open'`,
    [dueSessionId],
  );
  expect(rows).toEqual([
    { status: "applied", decider: INSTANCE_ACCOUNT.email },
  ]);
});

test("applying the skip proposal marks the missed session skipped", async () => {
  const card = page
    .locator('[id^="proposal-"]')
    .filter({ hasText: `Mark the session "${MISSED_TITLE}" as skipped` });
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });

  expect(await stateOf(missedSessionId)).toBe("skipped");
});
