/**
 * Joining a workspace because it trusts your email domain (REQUIREMENTS §4
 * People and org, P6-G06b "trusted-domain joining offered where the workspace
 * allows it"; completeness review M-34).
 *
 * **The setting was saved and nothing happened.** An administrator could list
 * trusted domains on the general card, and no screen ever offered anybody the
 * workspace, because which workspaces trust a domain was a question nobody
 * outside them could ask. This walks the whole path in a browser: the card
 * saves the domain, a confirmed address is offered the workspace and joins it
 * with one press, somebody who would rather have their own is offered it again
 * on their front door, and an unconfirmed address is offered nothing.
 *
 * **Accounts are created with the page's own fetch rather than the form.** The
 * form lands on `/` the moment the account exists, and this instance has no
 * mail, so nobody's address is confirmed at that moment and the front door
 * rightly gives them a workspace of their own. Posting to the same endpoint the
 * form posts to leaves the person signed in and not yet landed, the address is
 * then marked confirmed the way following the email link would, and only then
 * does the spec open the product.
 *
 * **This spec opens registration and closes it again**, like s35-join, and
 * clears the trusted domain it set, so nothing after it runs against a state it
 * did not ask for.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn, skipOnboarding } from "./instance-account.ts";

const DOMAIN = "trusted.example";
const PASSWORD = "correct-horse-battery-staple-9";
const DOMAIN_FIELD = "Trusted email domains (comma-separated)";

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
let workspaceName: string;
let workspaceId: string;

/** Every live workspace this address belongs to. */
async function membershipsOf(email: string): Promise<string[]> {
  const rows = await pool.query<{ workspace_id: string }>(
    `select m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null`,
    [email],
  );
  return rows.rows.map((row) => row.workspace_id);
}

/**
 * A new account, signed in and not yet landed anywhere.
 *
 * From a signed-out page on this origin, so the browser sends its own origin
 * and keeps the session cookie the response sets, exactly as the form does.
 */
async function signUpWithoutLanding(
  browser: Browser | null,
  email: string,
  name: string,
): Promise<{ visitor: Page; close: () => Promise<void> }> {
  const fresh = await browser?.newContext();
  if (!fresh) {
    throw new Error("No browser to open a fresh context in.");
  }
  const visitor = await fresh.newPage();
  await visitor.goto("/sign-in");
  const status = await visitor.evaluate(
    async (body) => {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { email, name, password: PASSWORD },
  );
  expect(status).toBe(200);
  return { visitor, close: () => fresh.close() };
}

/** What following the confirmation link does to the account. */
async function confirm(email: string): Promise<void> {
  await pool.query("update users set email_verified = true where email = $1", [
    email,
  ]);
}

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

test("the owner trusts a domain on the general card, which says what that does", async () => {
  await expect(async () => {
    await goTo(page, "/admin/general");
    await expect(page.getByLabel(DOMAIN_FIELD)).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });

  // The condition the setting depends on is said beside it.
  await expect(page.getByText(/Confirming an address needs mail/)).toBeVisible();

  await page.getByLabel(DOMAIN_FIELD).fill(DOMAIN);
  await page
    .locator("form")
    .filter({ has: page.getByLabel(DOMAIN_FIELD) })
    .getByRole("button", { name: "Save", exact: true })
    .click();

  await expect
    .poll(
      async () =>
        (
          await pool.query<{ id: string }>(
            "select id from workspaces where settings -> 'trustedEmailDomains' ? $1",
            [DOMAIN],
          )
        ).rowCount,
      { timeout: 15_000 },
    )
    .toBe(1);
  const trusted = await pool.query<{ id: string; name: string }>(
    "select id, name from workspaces where settings -> 'trustedEmailDomains' ? $1",
    [DOMAIN],
  );
  workspaceId = trusted.rows[0]?.id ?? "";
  workspaceName = trusted.rows[0]?.name ?? "";
  expect(workspaceName).not.toBe("");

  // Open, as on a cloud instance or one an operator opened. On an
  // invitation-only instance only an invitation creates an account.
  await pool.query(
    `insert into system_settings (key, value, created_at, updated_at)
     values ('registration.policy', to_jsonb('open'::text), now(), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
  );
});

test("an unconfirmed address is offered nothing and gets a workspace of its own", async () => {
  test.setTimeout(90_000);
  const email = "unconfirmed@trusted.example";
  const { visitor, close } = await signUpWithoutLanding(
    context.browser(),
    email,
    "Unconfirmed Person",
  );

  // Sign-up held off a workspace of their own, because a workspace trusts
  // their domain.
  expect(await membershipsOf(email)).toEqual([]);

  // Anybody can type an address at somebody else's company, so an
  // unconfirmed one is offered nothing, and the front door does what it has
  // always done.
  await goTo(visitor, "/");
  await expect(visitor).toHaveURL("/welcome", { timeout: 20_000 });
  const memberships = await membershipsOf(email);
  expect(memberships).toHaveLength(1);
  expect(memberships).not.toContain(workspaceId);
  await close();
});

test("a confirmed address with no workspace chooses on the join page, and joins with one press", async () => {
  test.setTimeout(120_000);
  const email = "joiner@trusted.example";
  const { visitor, close } = await signUpWithoutLanding(
    context.browser(),
    email,
    "Joining Person",
  );
  await confirm(email);

  // The front door sends them to choose before anything is made for them.
  await goTo(visitor, "/");
  await expect(visitor).toHaveURL(/\/join$/, { timeout: 20_000 });
  await goTo(visitor, "/join");
  await expect(
    visitor.getByRole("heading", { name: "Workspaces you can join" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    visitor.getByText(`Your confirmed address at ${DOMAIN}`),
  ).toBeVisible();
  await expect(
    visitor.getByRole("button", { name: "Start my own workspace" }),
  ).toBeVisible();

  await visitor
    .getByRole("button", { name: `Join ${workspaceName}`, exact: true })
    .click();
  await expect(
    visitor.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 20_000 });

  // In the workspace that trusts them and nowhere else: no stray workspace
  // of their own was made on the way.
  expect(await membershipsOf(email)).toEqual([workspaceId]);
  const audit = await pool.query<{ n: string }>(
    `select count(*)::text as n from audit_events
      where action = 'invitations.joinByTrustedDomain' and workspace_id = $1`,
    [workspaceId],
  );
  expect(Number(audit.rows[0]?.n ?? 0)).toBeGreaterThan(0);

  // Nothing is left to offer, so the join page sends them home.
  await goTo(visitor, "/join");
  await expect(visitor).toHaveURL("/", { timeout: 20_000 });
  await close();
});

test("somebody who starts their own is offered the trusted workspace on their front door", async () => {
  test.setTimeout(150_000);
  const email = "founder@trusted.example";
  const { visitor, close } = await signUpWithoutLanding(
    context.browser(),
    email,
    "Founding Person",
  );
  await confirm(email);

  await goTo(visitor, "/");
  await expect(visitor).toHaveURL(/\/join$/, { timeout: 20_000 });
  await visitor
    .getByRole("button", { name: "Start my own workspace" })
    .click();

  // Their own workspace, which owes its owner a setup like any other.
  await skipOnboarding(visitor);
  await expect(
    visitor.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 20_000 });
  expect(await membershipsOf(email)).toHaveLength(1);

  // The offer is still there, on the page every sign-in lands on.
  await goTo(visitor, "/");
  await expect(
    visitor.getByRole("heading", { name: "Workspaces you can join" }),
  ).toBeVisible({ timeout: 15_000 });
  await visitor
    .getByRole("button", { name: `Join ${workspaceName}`, exact: true })
    .click();
  await expect(
    visitor.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible({ timeout: 20_000 });

  // The navigation was on screen before the press, so it says nothing about
  // the join having landed; the membership rows do.
  await expect
    .poll(async () => (await membershipsOf(email)).length, { timeout: 20_000 })
    .toBe(2);
  const memberships = await membershipsOf(email);
  expect(memberships).toContain(workspaceId);
  await close();
});

test("the instance is left as the other specs expect it", async () => {
  await pool.query(
    `update workspaces
        set settings = settings || '{"trustedEmailDomains": []}'::jsonb
      where id = $1`,
    [workspaceId],
  );
  await pool.query(
    "delete from system_settings where key = 'registration.policy'",
  );
});
