/**
 * The weekly digest panel — P4-T15b-a (screen S-22, METHOD.md §7.2 step 4).
 *
 * Acceptance criterion:
 *   Given a weekly session with a digest, when the assist drafts it, then the
 *   draft is a proposal over the deterministic template and the template is
 *   still what a provider-off workspace gets.
 *
 * **The half a browser can prove here is the second half, and it is the half
 * that matters most.** This instance has no AI provider, so no narration is
 * offered and the panel shows the deterministic digest: §7.2's six parts, in
 * order, assembled with no model involved. That is what a self-hosted install
 * without an API key reads every week. The narration and its number check are
 * proved in `packages/core/test/rhythm-assists.test.ts`.
 *
 * The session and its digest row are written with `pg`, the same way
 * `sessions.spec.ts` creates its session: there is no create-session screen, and
 * driving a weekly session through four stages to reach step 4 is that spec's
 * subject rather than this one's.
 *
 * **The file name carries the run order.** Specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`. `s22` is screen S-22.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
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

test("sign in", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a weekly session has reached step 4", async () => {
  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
       where u.email = $1
       limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  const { id: memberId, workspace_id: workspaceId } = member;

  const space = (
    await pool.query<{ id: string }>(
      "select id from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [workspaceId],
    )
  ).rows[0];
  const cycle = (
    await pool.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!space || !cycle) {
    throw new Error("No space or cycle to hold the session.");
  }

  // `okr_sessions`, not `sessions`: Better Auth owns that name.
  const session = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          facilitator_id, state, stage_key)
       values (gen_random_uuid(), $1, $2, $3, 'weekly', 'Digest QA',
               now() - interval '1 hour', $4, 'running', 'digest')
       returning id`,
      [workspaceId, space.id, cycle.id, memberId],
    )
  ).rows[0];
  sessionId = session?.id as string;

  const digest = (
    await pool.query<{ id: string }>(
      `insert into digests
         (id, workspace_id, scope, scope_id, period, period_start, body, note, generated_at)
       values (gen_random_uuid(), $1, 'space', $2, 'weekly', '2026-08-24',
               $3::jsonb, 'Billing is the whole story this week.', now())
       returning id`,
      [
        workspaceId,
        space.id,
        JSON.stringify({
          averageConfidence: 0.62,
          onTrackCount: 3,
          atRiskCount: 0,
          blockerCount: 0,
          commitmentCount: 4,
        }),
      ],
    )
  ).rows[0];
  await pool.query("update okr_sessions set digest_id = $1 where id = $2", [
    digest?.id,
    sessionId,
  ]);
});

test("the panel shows §7.2's six parts, with no provider involved", async () => {
  await goTo(page, `/session/${sessionId}`);

  const digest = page.getByRole("list", { name: "The digest" });
  await expect(digest).toBeVisible({ timeout: 15_000 });

  // The headline and the change on last week. There is no previous digest for
  // this space, so the line carries the average and says nothing about a week
  // that did not happen.
  await expect(digest).toContainText("confidence 62%");
  await expect(digest).toContainText("3 objectives on track.");
  await expect(digest).toContainText("Nothing at risk.");
  await expect(digest).toContainText("No blockers open.");
  await expect(digest).toContainText("4 commitments for next week.");
  await expect(digest).toContainText(
    "For leadership: Billing is the whole story this week.",
  );
});

test("no narration is offered, and none is needed", async () => {
  // The acceptance criterion's second half: the template is what a provider-off
  // workspace gets, and it is complete on its own.
  await expect(page.getByRole("button", { name: "Narrate it" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Narrated digest" }),
  ).toHaveCount(0);
});
