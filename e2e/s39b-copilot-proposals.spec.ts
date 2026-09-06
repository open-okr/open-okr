/**
 * Copilot proposals in the panel — P4-T14b-a (screen S-39).
 *
 * Acceptance criterion:
 *   Given a member asking the copilot to create a goal, when they approve the
 *   proposal, then the goal is created through the normal Operation with audit,
 *   an AI provenance chip and a working undo.
 *
 * **The proposal is inserted with SQL, and it has to be.** A proposal only exists
 * because a model wrote one, and this instance has no AI provider, so nothing a
 * browser can do here produces one. The same reason `sessions.spec.ts` creates
 * its session with `pg`: the path from a model to a proposal is covered in
 * `packages/core/test/copilot-proposals.test.ts` and
 * `packages/agents/test/copilot-drafter.test.ts` against scripted providers.
 * What only a browser can prove is the part after that, which is what a reader
 * sees and what the buttons do.
 *
 * **The file name carries the run order.** Specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` is the one that claims it, so
 * anything that signs in has to sort after `registration-`. `s39b` follows
 * `s39-copilot.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason `sessions.spec.ts` records at length:
      // these setup queries have to find the workspace before they could set
      // `app.workspace_id`, and the application role sees nothing until it is.
      testDbEnv.superuser,
    );

const TITLE = "Cut mid-market onboarding to two days";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let workspaceId: string;
let memberId: string;
let threadId: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

/**
 * Opens the panel by clicking, not by pressing ⌘J.
 *
 * The shortcut is `s39-copilot.spec.ts`'s subject and is proved there. Here it
 * was a source of flake: a key press sent while a navigation is still settling
 * goes nowhere, and this file navigates between its tests. Waiting for the Work
 * Map heading and then clicking the button is the same door, held open.
 */
async function openPanel(): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });
  const panel = page.getByRole("dialog", { name: "Copilot" });
  if (await panel.isVisible()) {
    return;
  }
  await page.getByRole("button", { name: "Ask the copilot" }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
}

test("sign in and land on the Work Map", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a proposal is waiting in a conversation", async () => {
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
  memberId = member.id;
  workspaceId = member.workspace_id;

  const space = (
    await pool.query<{ id: string; name: string }>(
      "select id, name from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!space) {
    throw new Error("No space to own the objective.");
  }
  const cycle = (
    await pool.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!cycle) {
    throw new Error("No cycle to put the objective in.");
  }

  const thread = (
    await pool.query<{ id: string }>(
      `insert into ai_threads (id, workspace_id, member_id, title)
       values (gen_random_uuid(), $1, $2, 'Onboarding objective')
       returning id`,
      [workspaceId, memberId],
    )
  ).rows[0];
  threadId = thread?.id as string;
  await pool.query(
    `insert into ai_messages (id, workspace_id, thread_id, role, content)
     values (gen_random_uuid(), $1, $2, 'member', 'Create an objective for onboarding')`,
    [workspaceId, threadId],
  );

  // The payload a `buildProposal` call would have produced: every identifier is
  // the product's, and the preview and the sentence travel beside it.
  await pool.query(
    `insert into proposed_changes
       (id, workspace_id, run_id, thread_id, action, payload, subject_type, subject_id, status, ai_generated)
     values (gen_random_uuid(), $1, null, $2, 'goals.create', $3::jsonb, 'space', $4, 'pending', true)`,
    [
      workspaceId,
      threadId,
      JSON.stringify({
        title: TITLE,
        cycleId: cycle.id,
        level: "team",
        ownerKind: "space",
        spaceId: space.id,
        championId: memberId,
        reviewerId: memberId,
        weight: 1,
        __preview: [
          { label: "Objective", value: TITLE },
          { label: "Level", value: "team" },
          { label: "Space", value: space.name },
        ],
        __why: "You asked for an onboarding objective and this cycle has none.",
      }),
      space.id,
    ],
  );
});

test("the panel shows it with its provenance, its preview and its reason", async () => {
  await openPanel();
  const panel = page.getByRole("dialog", { name: "Copilot" });

  await panel
    .getByRole("button", { name: "Onboarding objective" })
    .click();

  const card = panel.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The provenance chip: a reviewer's first question is who wrote this.
  await expect(card.getByText("AI", { exact: true })).toBeVisible();
  await expect(card.getByText("goals.create")).toBeVisible();
  await expect(card.getByText(TITLE)).toBeVisible();
  await expect(
    card.getByText("You asked for an onboarding objective", { exact: false }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Dismiss" })).toBeVisible();
  // Nothing is offered for undoing something that has not been applied.
  await expect(card.getByRole("button", { name: "Undo" })).toBeHidden();
});

test("applying it creates the objective through the normal Operation", async () => {
  const panel = page.getByRole("dialog", { name: "Copilot" });
  const card = panel.getByRole("region", { name: "Proposed change" });
  await card.getByRole("button", { name: "Apply" }).click();

  await expect(card.getByText("Applied")).toBeVisible({ timeout: 20_000 });
  // Now an undo is offered, because `goals.create` has a reverse.
  await expect(card.getByRole("button", { name: "Undo" })).toBeVisible();

  const goal = (
    await pool.query<{ id: string; title: string }>(
      "select id, title from goals where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TITLE],
    )
  ).rows[0];
  expect(goal?.title).toBe(TITLE);

  // Through the pipeline means an audit row for the goal's own creation, not
  // only for the decision to apply it.
  const audit = await pool.query<{ action: string }>(
    "select action from audit_events where target_id = $1",
    [goal?.id],
  );
  expect(audit.rows.map((row) => row.action)).toContain("goals.create");

  // And it is really there, on the page the objective lives on.
  await page.goto(`/goals/${goal?.id}`);
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
});

test("undoing it removes the objective and says so", async () => {
  // The previous test navigated to the objective's own page, so the panel is
  // closed and the shell has just rendered again.
  await page.goto("/");
  await openPanel();
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await panel.getByRole("button", { name: "Onboarding objective" }).click();

  const card = panel.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "Undo" }).click();

  await expect(card.getByText("Undone")).toBeVisible({ timeout: 20_000 });

  const live = await pool.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1 and title = $2 and deleted_at is null",
    [workspaceId, TITLE],
  );
  expect(live.rows[0]?.count).toBe("0");

  // Soft, not gone: the row is still there for every audit and activity row
  // that points at it.
  const removed = await pool.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1 and title = $2 and deleted_at is not null",
    [workspaceId, TITLE],
  );
  expect(removed.rows[0]?.count).toBe("1");

  // Applied and then undone. Both are true, and the record says both.
  const proposal = await pool.query<{ status: string; undone_at: Date | null }>(
    "select status, undone_at from proposed_changes where thread_id = $1",
    [threadId],
  );
  expect(proposal.rows[0]?.status).toBe("applied");
  expect(proposal.rows[0]?.undone_at).not.toBeNull();
});
