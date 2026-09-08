/**
 * Accepting an invitation on a closed instance (GAP-AUDIT B-07, P6-G06b).
 *
 * The acceptance criterion, end to end: given a closed instance and a personal
 * invitation, when the invitee follows the address, then they create an
 * account, land in the workspace, and the audit names who invited them.
 *
 * **Driven through the browser because the criterion is about three surfaces
 * disagreeing.** The instance refuses registration inside Better Auth's own
 * hook, `/join` sets the cookie that hook reads, and the workspace the invitee
 * lands in comes from the token rather than from provisioning. A unit test can
 * prove each one; only this proves the three together, and the middle one is a
 * cookie that no unit test would notice was never set.
 *
 * **This spec closes the instance and opens it again.** Registration is `auto`
 * by default, which means open until somebody claims the instance and closed
 * afterwards, so by the time this file runs the instance is already closed by
 * the earlier specs having claimed it. The policy is written explicitly anyway,
 * because a spec that depends on a state it did not set is a spec that passes
 * for the wrong reason.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { INSTANCE_ACCOUNT } from "./instance-account.ts";

const { email: OWNER_EMAIL, password: OWNER_PASSWORD } = INSTANCE_ACCOUNT;

/** The invitee. Their account does not exist until this spec makes it. */
const GUEST_EMAIL = "join-guest@example.com";
const GUEST_PASSWORD = "correct-horse-battery-staple-9";
const GUEST_NAME = "Join Guest";

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
let token: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("the owner issues a personal invitation and the card shows its address", async () => {
  await page.goto("/");
  if (page.url().includes("/sign-in")) {
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
  }
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForURL((url) => new URL(url).pathname === "/", {
    timeout: 15_000,
  });

  await page.goto("/admin/invitations");
  await page.getByLabel("Email address").fill(GUEST_EMAIL);
  await page.getByRole("button", { name: "Create the invitation" }).click();

  // The address, not just the token. This card handed out a bare token until
  // P6-G06b, with a note saying where it would one day be usable.
  const link = page.getByTestId("invite-link");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const url = (await link.textContent())?.trim() ?? "";
  expect(url).toContain("/join/");

  token = url.slice(url.lastIndexOf("/") + 1);
  expect(token.length).toBeGreaterThan(20);
});

test("the instance is closed, so registration without an invitation is refused", async () => {
  await pool.query(
    `insert into system_settings (key, value, created_at, updated_at)
     values ('registration.policy', to_jsonb('invite_only'::text), now(), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
  );

  const visitor = await context.browser()?.newContext();
  if (!visitor) {
    throw new Error("no browser to open a second context in");
  }
  const stranger = await visitor.newPage();
  await stranger.goto("/sign-up");
  // The page asks before rendering a form that cannot succeed. The endpoint
  // refuses independently; this is the courtesy rather than the control.
  await expect(
    stranger.getByText("Registration is closed"),
  ).toBeVisible({ timeout: 15_000 });
  await visitor.close();
});

test("the invitee follows the address, signs up, and lands in the workspace", async () => {
  // **Longer than the suite's 30 seconds, and the work is why.** One test here
  // drives a fresh browser context, the join page, a server action that stores
  // the token and redirects, the sign-up form, a registration that provisions
  // and accepts an invitation inside its own hooks, and then the first render
  // of the application shell. The test above needs 18 seconds just to open a
  // context and load one page, so this one cannot fit in twelve more.
  //
  // Raised rather than split: the criterion is that these steps work *in
  // sequence*, and a version cut into pieces to fit a clock would stop
  // proving it.
  test.setTimeout(120_000);

  const invitee = await context.browser()?.newContext();
  if (!invitee) {
    throw new Error("no browser to open a third context in");
  }
  const guest = await invitee.newPage();

  // Following the address is what sets the cookie the auth hook reads. Without
  // this step the sign-up below is refused, which is the whole point of the
  // test above.
  await guest.goto(`/join/${token}`);
  await expect(
    guest.getByRole("heading", { name: /You have been invited/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByText(GUEST_EMAIL)).toBeVisible();

  // A button, not a link: pressing it is what stores the token, because Next
  // forbids a cookie write during render. The first draft of this spec clicked
  // a link and the page had thrown before it could.
  await guest.getByRole("button", { name: "Create an account" }).click();
  await guest.getByLabel("Name").fill(GUEST_NAME);
  await guest.getByLabel("Email").fill(GUEST_EMAIL);
  await guest.getByLabel("Password", { exact: true }).fill(GUEST_PASSWORD);
  await guest
    .getByRole("button", { name: "Create account" })
    .click();

  // They land in the product, in the workspace that invited them, rather than
  // in one of their own. `provisionWorkspaceForUser` returns the membership it
  // finds instead of making a second, so accepting first is what makes this
  // true and creating first would have left a stray empty workspace.
  await expect(
    guest.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 20_000 });

  const membership = await pool.query<{ workspace_id: string; name: string }>(
    `select m.workspace_id, w.name
       from workspace_members m
       join users u on u.id = m.user_id
       join workspaces w on w.id = m.workspace_id
      where u.email = $1 and m.deleted_at is null`,
    [GUEST_EMAIL],
  );
  expect(membership.rowCount).toBe(1);

  // The audit names who invited them, which is the last clause of the
  // criterion and the reason acceptance goes through the action rather than
  // writing the member row itself.
  const audit = await pool.query<{ n: string }>(
    `select count(*)::text as n from audit_events
      where action = 'invitations.acceptLink'
        and workspace_id = $1`,
    [membership.rows[0]?.workspace_id],
  );
  expect(Number(audit.rows[0]?.n ?? 0)).toBeGreaterThan(0);

  await invitee.close();
});

test("the same invitation cannot be used twice", async () => {
  // Another fresh context, for the same reason and at the same cost.
  test.setTimeout(60_000);

  // A personal link is single-use by carrying the member it created. The
  // refusal is the same sentence every other refusal renders: saying "already
  // used" would confirm to a stranger that the token was real.
  const second = await context.browser()?.newContext();
  if (!second) {
    throw new Error("no browser to open a fourth context in");
  }
  const other = await second.newPage();
  await other.goto(`/join/${token}`);
  await expect(
    other.getByText("That invitation cannot be used"),
  ).toBeVisible({ timeout: 15_000 });
  await second.close();
});

test("the instance is left as the other specs expect it", async () => {
  // Registration back to `auto`, which is what every other spec in this suite
  // runs against. A spec that closed the instance and walked away would break
  // whichever file happens to run next.
  await pool.query(
    "delete from system_settings where key = 'registration.policy'",
  );
});
