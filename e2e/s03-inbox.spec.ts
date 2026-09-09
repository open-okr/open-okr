/**
 * The in-app inbox (screen S-03, P6-G07a).
 *
 * The acceptance criterion, end to end: given a notification addressed to the
 * signed-in member, when they open the inbox, then the row is listed with its
 * reason, it deep-links to its subject, and marking it read clears the sidebar
 * badge.
 *
 * **Driven through the browser because the criterion spans three surfaces.**
 * The list is one read, the badge is another, and the mark-read is a write that
 * has to move both. A unit test proves each read answers; only this proves the
 * screen calls them and that the number beside "Inbox" is the same number the
 * page shows.
 *
 * The notification is written straight into the database rather than produced
 * by a check-in, and that is deliberate: what is under test is the inbox, not
 * the fan-out, and the fan-out has its own suite in `packages/core`. Writing
 * the row directly also lets this spec pick the reason and the subject, which a
 * check-in would not.
 *
 * Runs after `registration-to-dashboard.spec.ts`, which claims the instance and
 * drafts the goal this notification points at. Playwright runs one worker with
 * `fullyParallel: false`, so that order holds.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import pg from "pg";
import { INSTANCE_ACCOUNT } from "./instance-account.ts";

const { email: EMAIL, password: PASSWORD } = INSTANCE_ACCOUNT;

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason every other spec here records: these
      // setup queries have to find the workspace before they could set
      // `app.workspace_id`, and the forced row-level security policy would
      // otherwise answer with nothing rather than raising.
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;

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
  await page.goto("/");
  if (page.url().includes("/sign-in")) {
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
  }
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
    timeout: 15_000,
  });

  // **The shell being visible is not the navigation being finished.** Signing
  // in ends in a client-side push to `/` that can still be in flight after the
  // sidebar has painted, and the next test's `page.goto("/inbox")` then loses
  // the race: Playwright reported "navigation to /inbox is interrupted by
  // another navigation to /", intermittently, on a spec that had passed twice.
  // Waiting for the push to land is what makes this file deterministic rather
  // than usually fine.
  await page.waitForURL((url) => new URL(url).pathname === "/", {
    timeout: 15_000,
  });
});

test("a notification is listed, links to its goal, and clears the badge", async () => {
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
  if (!member) {
    throw new Error(`Member not found for ${EMAIL}`);
  }

  // The goal the first spec drafted. The subject is what the row links to, so
  // a real one is what makes the link assertable.
  const goal = (
    await pool.query<{ id: string }>(
      `select id from goals
        where workspace_id = $1 and deleted_at is null
        order by created_at asc
        limit 1`,
      [member.workspace_id],
    )
  ).rows[0];
  if (!goal) {
    throw new Error("No goal in the workspace to notify about");
  }

  await pool.query(
    `insert into notifications
       (id, workspace_id, recipient_member_id, subject_type, subject_id,
        reason, channel)
     values (gen_random_uuid(), $1, $2, 'goal', $3, 'mentioned', 'app')`,
    [member.workspace_id, member.id, goal.id],
  );

  await page.goto("/inbox");

  // **Scoped to the list, not the page.** The filter row carries a chip per
  // reason with the same words the row's own chip uses, so `getByText` over
  // the whole page matches the filter link and passes whether or not a row
  // exists. The first draft of this spec did exactly that, and the snooze test
  // below is what caught it: a count that could never reach zero. The list is
  // a labelled region for this reason, and because a screen reader met an
  // unnamed run of sections without it.
  const list = page.getByRole("region", { name: "Notifications" });

  // The reason chip, which is the part §4 asks for by name.
  await expect(list.getByText("Mentioned").first()).toBeVisible({
    timeout: 15_000,
  });

  // The badge beside Inbox in the primary block. It is the unread count and
  // the page's own count is the same number, which is the whole reason the
  // badge reads `notifications.unreadCount` rather than a second query.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: /Inbox/ })).toContainText("1");

  // The deep link: the group heading and the row both point at the goal.
  await expect(
    list.locator(`a[href="/goals/${goal.id}"]`).first(),
  ).toBeVisible();

  // Mark read, and both the row's dot and the badge go with it.
  await page.getByRole("button", { name: "Mark read" }).first().click();
  await expect(nav.getByRole("link", { name: /Inbox/ })).not.toContainText(
    "1",
    { timeout: 15_000 },
  );
});

test("snoozing a row takes it off the list without deleting it", async () => {
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
  if (!member) {
    throw new Error(`Member not found for ${EMAIL}`);
  }

  await pool.query(
    `insert into notifications
       (id, workspace_id, recipient_member_id, reason, channel)
     values (gen_random_uuid(), $1, $2, 'joined', 'app')`,
    [member.workspace_id, member.id],
  );

  await page.goto("/inbox");
  const list = page.getByRole("region", { name: "Notifications" });
  await expect(list.getByText("Joined").first()).toBeVisible({
    timeout: 15_000,
  });

  await list.getByRole("button", { name: "Next week" }).first().click();

  await expect(list.getByText("Joined")).toHaveCount(0, { timeout: 15_000 });

  // Off the list, still in the table. A snooze that deleted the row would be
  // losing what happened rather than deferring it.
  const remaining = await pool.query<{ n: string }>(
    `select count(*)::text as n from notifications
      where workspace_id = $1 and reason = 'joined' and deleted_at is null`,
    [member.workspace_id],
  );
  expect(Number(remaining.rows[0]?.n ?? 0)).toBeGreaterThan(0);
});

test("a row arrives in an open inbox without a reload", async () => {
  // **P6-G07b's acceptance sentence, owned by P6-G07c.** The inbox had a
  // screen from P6-G07a and no way to learn that a row had landed.
  //
  // The whole chain runs here: an outbox row is drained by the relay inside
  // this same server process, published on the recipient's own channel, read
  // by `/api/inbox/live`, and answered by a `router.refresh()` that re-renders
  // the list. The page is never navigated after it is opened, which is what
  // "without a reload" means.
  //
  // The notification row and its outbox row are written directly, the way
  // every other case in this file writes its row: what is under test is the
  // arrival, not the fan-out. That `notifyRecipients` writes exactly this pair
  // in one transaction is proved against a real database in
  // `packages/core/test/notifications.test.ts`.
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
  if (!member) {
    throw new Error(`Member not found for ${EMAIL}`);
  }

  await page.goto("/inbox");
  const list = page.getByRole("region", { name: "Notifications" });
  await expect(list).toBeVisible({ timeout: 15_000 });
  const before = await list.getByText("To review").count();

  const inserted = (
    await pool.query<{ id: string }>(
      `insert into notifications
         (id, workspace_id, recipient_member_id, reason, channel)
       values (gen_random_uuid(), $1, $2, 'review', 'app')
       returning id`,
      [member.workspace_id, member.id],
    )
  ).rows[0];
  if (!inserted) {
    throw new Error("insert into notifications returned no row");
  }

  await pool.query(
    `insert into outbox (topic, payload, idempotency_key, available_at)
     values ('inbox.added', $1::jsonb, $2, now())`,
    [
      JSON.stringify({
        channel: `workspace:${member.workspace_id}:member:${member.id}:inbox`,
        workspaceId: member.workspace_id,
        recipientMemberId: member.id,
        notificationId: inserted.id,
        subjectType: "notification",
        subjectId: inserted.id,
        reason: "review",
      }),
      `inbox.added:${inserted.id}`,
    ],
  );

  // The line the component shows when it has refreshed, which is the signal
  // that the stream reached the browser rather than that the row exists.
  await expect(page.getByTestId("inbox-live")).toBeVisible({
    timeout: 30_000,
  });
  await expect(list.getByText("To review")).toHaveCount(before + 1, {
    timeout: 15_000,
  });

  // And no navigation happened: the reader is on the same url they opened.
  expect(new URL(page.url()).pathname).toBe("/inbox");
});
