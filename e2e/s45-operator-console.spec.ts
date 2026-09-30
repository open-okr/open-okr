/**
 * The cloud operator console, and the customer's plan screen, in a browser
 * (completeness review L-17, UIUX-PLAN.md §4 S-45 to S-47 and S-49,
 * P8-T03b and P8-T02b).
 *
 * **The suite builds a self-hosted instance, and this file makes it a cloud
 * one for its own length.** Every cloud screen answers not-found with
 * `cloud.enabled` off, which is why none had a path and why the route
 * coverage test carried a reason for each. The flag is an instance setting
 * resolved on every request, so writing it turns the same running server into
 * a cloud instance with no restart, and deleting it turns it back. Nothing
 * else about the instance changes.
 *
 * **Two new people, never the instance account's workspace.** Registration is
 * open on a cloud instance, so a customer and an operator each sign up and
 * each gets a workspace with a tenant row, which is what the console lists.
 * The instance account is the one who grants the operator, because the grant
 * refuses a person granting themselves, and it is also the proof that a
 * member without a grant meets not-found rather than a hint.
 *
 * **The grant is written to the table, not through `pnpm cloud:operator`.**
 * That command is the deployment's door and is proved in
 * `packages/core/test`; this file is about what the operator sees once they
 * are through it. The flag and the grant are both undone in `afterAll`, and
 * the suspension this file makes is lifted by the operator in its last step.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import {
  goTo,
  INSTANCE_ACCOUNT,
  signIn,
  skipOnboarding,
} from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const PASSWORD = "correct horse battery staple";
const CUSTOMER = { name: "Grace Hopper", email: "grace@example.net" } as const;
const OPERATOR = { name: "Olu Operator", email: "olu@example.net" } as const;
const CUSTOMER_WORKSPACE = `${CUSTOMER.name}'s workspace`;

// The superuser: `system_settings` and `instance_operators` sit above the
// tenant floor, and writing either is instance administration.
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

let pool: pg.Pool;
let customer: BrowserContext;
let operator: BrowserContext;
let customerPage: Page;
let operatorPage: Page;
let workspaceId = "";

const userId = async (email: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`${email} has no account`);
  }
  return id;
};

/**
 * Signs a new person up, or signs them in on a retry.
 *
 * Continuous integration retries once, and an address can register once.
 */
async function arrive(
  page: Page,
  person: { readonly name: string; readonly email: string },
): Promise<void> {
  const known = await pool.query("select 1 from users where email = $1", [
    person.email,
  ]);
  if (known.rowCount === 0) {
    await goTo(page, "/sign-up");
    await page.getByLabel("Name").fill(person.name);
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await skipOnboarding(page);
  } else {
    await goTo(page, "/sign-in");
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
  }
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  await pool.query(
    `insert into system_settings (key, value, source)
     values ('cloud.enabled', 'true'::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
  );
  customer = await browser.newContext();
  operator = await browser.newContext();
  customerPage = await customer.newPage();
  operatorPage = await operator.newPage();
});

test.afterAll(async () => {
  // Undone whatever happened above, so no later spec runs against a cloud.
  if (pool) {
    await pool.query("delete from system_settings where key = 'cloud.enabled'");
    await pool.query(
      `update instance_operators set revoked_at = now()
        where user_id = (select id from users where email = $1)
          and revoked_at is null`,
      [OPERATOR.email],
    );
    await pool.end();
  }
  await customer?.close();
  await operator?.close();
});

test("a customer signs up and gets a workspace of their own", async () => {
  await arrive(customerPage, CUSTOMER);
  await expect(customerPage.getByText(CUSTOMER_WORKSPACE).first()).toBeVisible();
});

test("the customer's administrator reads their plan, which only a cloud has", async () => {
  await goTo(customerPage, "/admin/plan");
  await expect(
    customerPage.getByRole("heading", { level: 1, name: "Plan and seats" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    customerPage.getByRole("heading", { level: 2, name: "Current plan" }),
  ).toBeVisible();
  // No plan chosen is the free tier with no seat limit, so a signup is never
  // refused for a plan nobody picked.
  await expect(
    customerPage.getByText("This workspace has no seat limit."),
  ).toBeVisible();
});

test("a member without a grant is told the console does not exist", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/operator");
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
});

test("an operator lists the tenants and opens one, and sees counts only", async () => {
  await arrive(operatorPage, OPERATOR);
  await pool.query(
    `insert into instance_operators (user_id, granted_by_user_id, note)
     values ($1, $2, 'granted by the end-to-end suite')
     on conflict (user_id) do update set revoked_at = null`,
    [await userId(OPERATOR.email), await userId(INSTANCE_ACCOUNT.email)],
  );

  await goTo(operatorPage, "/operator");
  await expect(
    operatorPage.getByRole("heading", { level: 1, name: "Workspaces" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    operatorPage.getByText(/^\d+ tenants? on this instance\./),
  ).toBeVisible();
  const row = operatorPage.getByRole("link", { name: CUSTOMER_WORKSPACE });
  await expect(row).toBeVisible();
  workspaceId = ((await row.getAttribute("href")) ?? "").split("/").pop() ?? "";
  expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);

  await goTo(operatorPage, `/operator/${workspaceId}`);
  await expect(
    operatorPage.getByRole("heading", { level: 1, name: CUSTOMER_WORKSPACE }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    operatorPage.getByText(/^Counts only\. Nothing a member of this workspace wrote/),
  ).toBeVisible();
});

test("the operator suspends the workspace with a reason, and lifts it again", async () => {
  expect(workspaceId, "the list named no workspace").not.toBe("");
  await goTo(operatorPage, `/operator/${workspaceId}`);

  // By id: the plan form above it has a field called Reason too.
  const moveTo = operatorPage.locator("#lifecycle-state");
  const reason = operatorPage.locator("#lifecycle-reason");
  const apply = operatorPage.getByRole("button", {
    name: `Apply to ${CUSTOMER_WORKSPACE}`,
  });
  await moveTo.selectOption("suspended");
  await reason.fill(
    "Your invoice is thirty days overdue. Reply to billing to restore it.",
  );
  await apply.click();
  await expect(
    operatorPage.getByText("This workspace is suspended"),
  ).toBeVisible({ timeout: 15_000 });

  // The last step puts it back, so the tenant this file made is left active.
  await moveTo.selectOption("active");
  await reason.fill("The invoice was paid. Thank you.");
  await apply.click();
  await expect(
    operatorPage.getByText("This workspace is suspended"),
  ).toHaveCount(0, { timeout: 15_000 });
});

test("the instance page says what is true of the deployment", async () => {
  await goTo(operatorPage, "/operator/instance");
  await expect(
    operatorPage.getByRole("heading", { level: 1, name: "This instance" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(operatorPage.getByRole("heading", { name: "Flags" })).toBeVisible();
  await expect(
    operatorPage.getByRole("heading", { name: "Messages" }),
  ).toBeVisible();
});
