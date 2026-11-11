/**
 * Turning email confirmation off (plan 0.8.0 S4,
 * docs/design/email-verification.md §11).
 *
 * Acceptance criteria:
 *   Given an instance where no confirmation waits (this suite's instance
 *   sends no mail, which is one such case), when somebody signs up, then they
 *   see "Welcome to {instance}" and "Your account has been created. You can
 *   use it right away." with Get started, and no word about confirming.
 *   When they press Get started, then they are in, without signing in again.
 *   Given an administrator of a self-hosted instance, then Admin, General
 *   shows the Email confirmation card, and a choice saved there sticks.
 *
 * The rule itself, auto and off with and without mail and under company
 * domains, is proved against a real database in
 * `packages/core/test/email-confirmation-setting.test.ts`.
 */
import type { BrowserContext, Page } from "@playwright/test";
import type pg from "pg";
import { expect, test } from "./fixtures.ts";
import {
  applySettings,
  clearSettings,
  instancePool,
  PASSWORD,
  personContext,
  RUN,
} from "./hosting.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let pool: pg.Pool;
let saved: unknown;
let visitor: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  pool = instancePool();
  // Open for this file only, and put back as it was found: a spec before
  // this one on the shard may have chosen a policy of its own.
  const { rows } = await pool.query<{ value: unknown }>(
    "select value from system_settings where key = 'registration.policy'",
  );
  saved = rows[0]?.value;
  await applySettings(pool, { "registration.policy": "open" });
  visitor = await personContext(browser);
  page = await visitor.newPage();
});

test.afterAll(async () => {
  if (pool) {
    if (saved === undefined) {
      await clearSettings(pool, ["registration.policy"]);
    } else {
      await applySettings(pool, { "registration.policy": saved });
    }
    await clearSettings(pool, ["auth.emailVerification"]);
    await pool.end();
  }
  await visitor?.close();
});

test("sign-up ends with a welcome, and nothing about confirming", async () => {
  await goTo(page, "/sign-up");
  await page.getByLabel("Name").fill(`Confirmation Off ${RUN}`);
  await page.getByLabel("Email").fill(`confirmation-off-${RUN}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  const card = page.getByTestId("account-created");
  await expect(card).toContainText(
    "Your account has been created. You can use it right away.",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("heading", { name: /^Welcome to / })).toBeVisible();
  await expect(page.getByText(/check your email|confirm/i)).toHaveCount(0);

  // Signed in already, so Get started goes straight in.
  await page.getByTestId("get-started").click();
  await page.waitForURL(
    (url) => url.pathname === "/" || url.pathname === "/welcome",
    { timeout: 30_000 },
  );
  expect(new URL(page.url()).pathname).not.toBe("/sign-in");
});

test("an administrator chooses on Admin, General, and the choice sticks", async ({
  page: admin,
}) => {
  await signIn(admin);
  await goTo(admin, "/admin/general");
  const card = admin.getByTestId("email-confirmation-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The suite's servers run with OPENOKR_EMAIL_VERIFICATION=off, which is
  // what the card starts on.
  await expect(card.getByTestId("email-confirmation-off")).toBeChecked();
  // This instance sends no mail, and the card says so rather than promising
  // a confirmation nobody could receive.
  await expect(card.getByTestId("email-confirmation-now")).toContainText(
    "cannot send mail",
  );

  await card.getByTestId("email-confirmation-auto").check();
  await card.getByRole("button", { name: "Save" }).click();
  await goTo(admin, "/admin/general");
  await expect(
    admin.getByTestId("email-confirmation-card").getByTestId(
      "email-confirmation-auto",
    ),
  ).toBeChecked({ timeout: 15_000 });
});
