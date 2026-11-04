/**
 * Who may create an account, chosen on Admin → General (docs/design/
 * registration-policy.md §5).
 *
 * **The policy was settable only in the database.** The wizard wrote it once
 * and nothing after it, so opening a claimed instance meant editing a row by
 * hand. This walks the card and the sign-up page it governs: the owner
 * chooses company email addresses, a free mail address is refused with the
 * reason, and a company address lands in a workspace of its own.
 *
 * **This spec changes the policy and puts it back**, like s35-join and
 * s35b-trusted-domain, so nothing after it runs against a state it did not
 * ask for.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const PASSWORD = "correct-horse-battery-staple-9";
const COMPANY_ADDRESS = `ana-${Date.now()}@company-only.example`;
const FREE_ADDRESS = `ana-${Date.now()}@gmail.com`;

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

async function usersCalled(email: string): Promise<number> {
  const rows = await pool.query<{ n: number }>(
    "select count(*)::int as n from users where email = $1",
    [email],
  );
  return rows.rows[0]?.n ?? 0;
}

/** A signed-out page in its own context, as a visitor would arrive. */
async function visitor(): Promise<{ page: Page; close: () => Promise<void> }> {
  const fresh = await context.browser()?.newContext();
  if (!fresh) {
    throw new Error("No browser to open a fresh context in.");
  }
  return { page: await fresh.newPage(), close: () => fresh.close() };
}

async function signUp(at: Page, email: string) {
  await at.goto("/sign-up");
  await at.getByLabel("Name").fill("Ana");
  await at.getByLabel("Email").fill(email);
  await at.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await at.getByRole("button", { name: "Create account" }).click();
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

test("the owner chooses company email addresses on General", async () => {
  await expect(async () => {
    await goTo(page, "/admin/general");
    await expect(page.getByTestId("registration-company_domains")).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });

  await page.getByTestId("registration-company_domains").check();
  await page
    .locator("form")
    .filter({ has: page.getByTestId("registration-company_domains") })
    .getByRole("button", { name: "Save", exact: true })
    .click();

  await expect
    .poll(
      async () =>
        (
          await pool.query<{ value: string }>(
            "select value #>> '{}' as value from system_settings where key = 'registration.policy'",
          )
        ).rows[0]?.value,
      { timeout: 15_000 },
    )
    .toBe("company_domains");
  // Said where it came from, and recorded on the instance's own chain.
  await page.reload();
  await expect(page.getByTestId("registration-source")).toHaveText(
    "Set here.",
  );
  const audit = await pool.query(
    "select 1 from instance_audit_events where action = 'instance.registration_changed'",
  );
  expect(audit.rowCount).toBeGreaterThan(0);
});

test("a free mail address is told to use a company one, and nothing is created", async () => {
  const { page: stranger, close } = await visitor();
  await signUp(stranger, FREE_ADDRESS);
  await expect(
    stranger.getByText(/Use your company email address to start a workspace/),
  ).toBeVisible({ timeout: 15_000 });
  expect(await usersCalled(FREE_ADDRESS)).toBe(0);
  await close();
});

test("a company address signs up and lands in a workspace of its own", async () => {
  const { page: stranger, close } = await visitor();
  await stranger.goto("/sign-up");
  // The form says the rule before anybody tries.
  await expect(stranger.getByTestId("company-only")).toBeVisible();
  await signUp(stranger, COMPANY_ADDRESS);
  await expect(stranger).not.toHaveURL(/\/sign-up/, { timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `select 1 from workspace_members m join users u on u.id = m.user_id
              where u.email = $1 and m.deleted_at is null`,
            [COMPANY_ADDRESS],
          )
        ).rowCount,
      { timeout: 15_000 },
    )
    .toBe(1);
  await close();
});

test("the instance is left as the other specs expect it", async () => {
  await pool.query(
    "delete from system_settings where key = 'registration.policy'",
  );
});
