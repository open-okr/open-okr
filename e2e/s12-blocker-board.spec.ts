/**
 * The open-blocker board — P4-T15b-b (METHOD.md §7.3 and §11, REQUIREMENTS §7).
 *
 * Acceptance criterion:
 *   Given a space with four open blockers of different ages, when the assist
 *   summarises them, then the order is the deterministic ranking and every
 *   blocker in the summary is one of the four.
 *
 * **The order is what a browser can prove here, and the order is the point.**
 * This instance has no AI provider, so no summary is offered; what the summary
 * would be written about is the board, and the board is what this asserts: four
 * blockers of different ages, ranked by §11's ladder rather than by age alone,
 * with the ones past §7.3's clock marked. The summary and its refusal to name a
 * blocker off the board are proved in
 * `packages/core/test/blocker-board.test.ts` against a scripted drafter.
 *
 * **The file name carries the run order:** specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { INSTANCE_ACCOUNT, goTo, signIn } from "./instance-account.ts";

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
let spaceId: string;

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

test("four blockers of different ages are open in a space", async () => {
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

  const space = (
    await pool.query<{ id: string }>(
      "select id from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [member.workspace_id],
    )
  ).rows[0];
  const cycle = (
    await pool.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on limit 1",
      [member.workspace_id],
    )
  ).rows[0];
  if (!space || !cycle) {
    throw new Error("No space or cycle to hold the session.");
  }
  spaceId = space.id;

  const session = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          facilitator_id, state, stage_key)
       values (gen_random_uuid(), $1, $2, $3, 'weekly', 'Blocker QA',
               now() - interval '1 hour', $4, 'running', 'blockers')
       returning id`,
      [member.workspace_id, spaceId, cycle.id, member.id],
    )
  ).rows[0];

  // Deliberately out of age order on insert, so the board is doing the ranking
  // rather than the database's own order doing it by accident.
  const ages: readonly [string, number][] = [
    ["Chase the design review", 21],
    ["Chase the billing team", 60],
    ["Chase nobody in particular", 3],
    ["Chase the legal team", 26],
  ];
  for (const [nextAction, ageHours] of ages) {
    await pool.query(
      `insert into blockers
         (id, workspace_id, type, owner_id, next_action, opened_at, due_at, session_id)
       values (gen_random_uuid(), $1, 'dependency', $2, $3,
               now() - ($4 || ' hours')::interval,
               now() - ($4 || ' hours')::interval + interval '24 hours',
               $5)`,
      [member.workspace_id, member.id, nextAction, String(ageHours), session?.id],
    );
  }
});

test("the board ranks them by the ladder, not by age alone", async () => {
  await goTo(page, `/spaces/${spaceId}`);

  const board = page.getByRole("list", { name: "Open blockers" });
  await expect(board).toBeVisible({ timeout: 15_000 });

  const items = board.getByRole("listitem");
  await expect(items).toHaveCount(4);

  // §11's ladder: sponsor at forty-eight hours, coordinator at twenty-four,
  // owner at twenty. Sixty hours outranks twenty-six even though both are past
  // the clock, and three hours is last.
  await expect(items.nth(0)).toContainText("Chase the billing team");
  await expect(items.nth(1)).toContainText("Chase the legal team");
  await expect(items.nth(2)).toContainText("Chase the design review");
  await expect(items.nth(3)).toContainText("Chase nobody in particular");
});

test("the ones past §7.3's clock say so, and the newest does not", async () => {
  const board = page.getByRole("list", { name: "Open blockers" });
  const items = board.getByRole("listitem");

  await expect(items.nth(0)).toContainText("past the clock");
  await expect(items.nth(0)).toContainText("escalated to sponsor");
  await expect(items.nth(1)).toContainText("escalated to coordinator");
  await expect(items.nth(2)).toContainText("escalated to owner");
  await expect(items.nth(3)).not.toContainText("past the clock");
  await expect(items.nth(3)).not.toContainText("escalated");
});

test("no summary is offered, and the board reads on its own", async () => {
  // The half a provider-off instance gets: the list, with owners and ages, which
  // is what REQUIREMENTS §7 asks for and needs no model.
  await expect(page.getByRole("button", { name: "Summarise" })).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Open blockers" }),
  ).toContainText("60h");
});
