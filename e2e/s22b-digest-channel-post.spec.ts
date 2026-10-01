/**
 * Posting the week's digest to the space's own channel (UIUX-PLAN S-22 step 4,
 * AI-NATIVE-PLAN §5.2, completeness review M-23).
 *
 * Acceptance criterion:
 *   Given a workspace with Slack connected and a space linked to a Slack
 *   channel, when the coordinator posts a closed weekly session's digest, then
 *   one message is queued for that channel and no member, and pressing again
 *   posts nothing more.
 *
 * The routing, the deduplication and the relay handing the channel to
 * `sendToChannel` are proved against a real database in
 * `packages/core/test/digest-posts.test.ts`. What only a browser proves is
 * that a space manager can reach the link at all, that the button appears on
 * the session only where it will post somewhere, and that it says what it did.
 * The Slack half stops at "queued", as `s36-channels.spec.ts` does: there is no
 * Slack workspace to deliver to.
 *
 * The closed session and its digest are written with `pg`, the way
 * `s22-weekly-digest.spec.ts` writes its own: driving a weekly session through
 * four stages is `sessions.spec.ts`'s subject.
 *
 * **Everything this spec changes, it changes back.** The space's channel is
 * cleared and Slack is disconnected at the end, because `s36-channels.spec.ts`
 * connects Slack itself and expects to find it disconnected.
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

/** Not the id `s36-channels.spec.ts` connects with: installations are unique. */
const TEAM_ID = "T-E2E-SPACE-POST";
const CHANNEL_ID = "C0E2ESPACE";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let workspaceId: string;
let spaceUrl: string;
let sessionId: string;

const slackForm = () =>
  page.locator("form").filter({ hasText: "Bot User OAuth Token" });

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("a space with nothing connected says who can change that", async () => {
  await goTo(page, "/spaces");
  await page.locator("a[href^='/spaces/']").first().click();
  await page.waitForURL(/\/spaces\/[0-9a-f-]{36}/);
  spaceUrl = new URL(page.url()).pathname;

  await expect(
    page.getByText("Neither Slack nor Teams is connected"),
  ).toBeVisible();
  await expect(page.locator("input[name='slackChannel']")).toHaveCount(0);
});

test("once Slack is connected, the space can link a channel", async () => {
  await goTo(page, "/admin/channels");
  const form = slackForm();
  await form.getByLabel("Bot token").fill("xoxb-e2e-space-post");
  await form.getByLabel("Signing or webhook secret").fill("e2e-space-secret");
  await form.getByLabel("Provider workspace id").fill(TEAM_ID);
  await form.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("connected rather than verified")).toBeVisible({
    timeout: 10_000,
  });

  await goTo(page, spaceUrl);
  const field = page.locator("input[name='slackChannel']");
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("");
  // Teams is not connected, so it is not offered.
  await expect(page.locator("input[name='teamsChannel']")).toHaveCount(0);

  await field.fill(CHANNEL_ID);
  await page.getByRole("button", { name: "Save space settings" }).click();
  await expect(page.getByTestId("space-settings-saved")).toBeVisible({
    timeout: 15_000,
  });

  await goTo(page, spaceUrl);
  await expect(page.locator("input[name='slackChannel']")).toHaveValue(
    CHANNEL_ID,
  );
});

test("a closed weekly session in that space has a digest", async () => {
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
  workspaceId = member.workspace_id;
  const spaceId = spaceUrl.split("/").at(-1) as string;
  const cycle = (
    await pool.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!cycle) {
    throw new Error("No cycle to hold the session.");
  }

  const digest = (
    await pool.query<{ id: string }>(
      `insert into digests
         (id, workspace_id, scope, scope_id, period, period_start, body, generated_at)
       values (gen_random_uuid(), $1, 'space', $2, 'weekly', '2026-08-31',
               $3::jsonb, now())
       returning id`,
      [
        workspaceId,
        spaceId,
        JSON.stringify({
          averageConfidence: 0.7,
          onTrackCount: 2,
          atRiskCount: 0,
          blockerCount: 0,
          commitmentCount: 3,
        }),
      ],
    )
  ).rows[0];
  const session = (
    await pool.query<{ id: string }>(
      `insert into okr_sessions
         (id, workspace_id, space_id, cycle_id, kind, title, scheduled_for,
          started_at, ended_at, facilitator_id, state, digest_id)
       values (gen_random_uuid(), $1, $2, $3, 'weekly', 'Channel post QA',
               now() - interval '2 hours', now() - interval '2 hours',
               now() - interval '1 hour', $4, 'closed', $5)
       returning id`,
      [workspaceId, spaceId, cycle.id, member.id, digest?.id],
    )
  ).rows[0];
  sessionId = session?.id as string;
});

test("the coordinator posts it to the space's channel, once (acceptance)", async () => {
  await goTo(page, `/session/${sessionId}`);
  await expect(page.getByRole("list", { name: "The digest" })).toBeVisible({
    timeout: 15_000,
  });

  const post = page.getByTestId("post-digest");
  await expect(post).toHaveText("Post to the space's channel");
  await post.click();
  await expect(page.getByTestId("post-digest-result")).toContainText(
    "Posted to Slack",
    { timeout: 15_000 },
  );

  const rows = await pool.query<{
    provider: string;
    member_id: string | null;
    target: string | null;
  }>(
    `select provider, member_id, payload->>'target' as target
       from channel_messages
      where workspace_id = $1 and idempotency_key like 'digest.post:%'`,
    [workspaceId],
  );
  expect(rows.rows).toEqual([
    { provider: "slack", member_id: null, target: CHANNEL_ID },
  ]);

  // Pressing again posts nothing more, and says so.
  await page.getByTestId("post-digest").click();
  await expect(page.getByTestId("post-digest-result")).toContainText(
    "Already posted to Slack",
    { timeout: 15_000 },
  );
  const again = await pool.query(
    "select count(*)::int as n from channel_messages where workspace_id = $1 and idempotency_key like 'digest.post:%'",
    [workspaceId],
  );
  expect(again.rows[0]?.n).toBe(1);
});

test("and everything is put back", async () => {
  await goTo(page, spaceUrl);
  await page.locator("input[name='slackChannel']").fill("");
  await page.getByRole("button", { name: "Save space settings" }).click();
  await expect(page.getByTestId("space-settings-saved")).toBeVisible({
    timeout: 15_000,
  });

  await goTo(page, "/admin/channels");
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await expect(
    page.getByRole("button", { name: "Send me a test" }),
  ).toBeHidden({ timeout: 10_000 });

  await goTo(page, spaceUrl);
  await expect(
    page.getByText("Neither Slack nor Teams is connected"),
  ).toBeVisible();
});
