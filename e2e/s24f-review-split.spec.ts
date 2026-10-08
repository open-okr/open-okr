/**
 * The review and the retrospective apart (P9-T20b-a, METHOD.md §8, §12).
 *
 * Acceptance:
 *   Given a workspace that holds the review and the retrospective
 *   separately, when a quarter is booked, then a review session runs stages
 *   1 to 4 and a retrospective runs stages 5 to 11.
 *
 * The booking and the link between the two are proved against a real
 * database in `packages/core/test/review-split.test.ts`. What only a browser
 * shows is each half's rail: the review stops at recognition, and the
 * retrospective opens on the team retro and still counts its stages out of
 * eleven. Both sessions are this spec's own and are deleted afterwards.
 */
import type { BrowserContext, Page } from "@playwright/test";
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

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let reviewId = "";
let retrospectiveId = "";

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  for (const id of [retrospectiveId, reviewId]) {
    if (id) {
      await pool.query(
        "update okr_sessions set deleted_at = now() where id = $1",
        [id],
      );
    }
  }
  await pool?.end();
  await context?.close();
});

test("sign in, with a review and its retrospective held apart", async () => {
  await signIn(page);
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

  // The review half at its last stage, and the retrospective on its first.
  // `okr_sessions`, not `sessions`: Better Auth owns that name.
  reviewId = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, kind, title, scheduled_for,
          facilitator_id, state, started_at, stage_key, stage_started_at,
          review_part)
       values (gen_random_uuid(), $1, $2, 'quarterly', 'Quarterly review',
               now(), $3, 'running', now(), 'recognition', now(), 'review')
       returning id`,
      [member.workspace_id, space.id, member.id],
    )
  ).rows[0]?.id as string;
  retrospectiveId = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, kind, title, scheduled_for,
          facilitator_id, state, started_at, stage_key, stage_started_at,
          review_part, review_session_id)
       values (gen_random_uuid(), $1, $2, 'quarterly',
               'Quarterly retrospective', now() + interval '2 days', $3,
               'running', now(), 'team_retro', now(), 'retrospective', $4)
       returning id`,
      [member.workspace_id, space.id, member.id, reviewId],
    )
  ).rows[0]?.id as string;
});

test("acceptance: the review runs stages 1 to 4 and stops at recognition", async () => {
  await goTo(page, `/session/${reviewId}`);
  await expect(page.getByText(/Stage 4 of 11/).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Score the key results").first()).toBeVisible();
  // The retrospective's stages are not on this rail.
  await expect(page.getByText("Team retro", { exact: true })).toHaveCount(0);
  // The last stage of its half: nothing to continue to.
  await expect(
    page.getByRole("button", { name: "Continue to next step" }),
  ).toHaveCount(0);
});

test("acceptance: the retrospective runs stages 5 to 11 from the team retro", async () => {
  await goTo(page, `/session/${retrospectiveId}`);
  await expect(page.getByText(/Stage 5 of 11/).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Decisions and actions").first()).toBeVisible();
  await expect(page.getByText("Open and check-in", { exact: true })).toHaveCount(
    0,
  );
});
