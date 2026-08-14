import { expect, test } from "@playwright/test";

/**
 * The first-run wizard, in a browser (P1-T09).
 *
 * The acceptance criterion is "given a clean server, when compose and the
 * wizard run, then a secured instance with an admin exists inside the
 * 30-minute budget". Only a browser against a real instance settles it, and
 * the interesting parts are the ones that are easy to get backwards:
 *
 *   - an unconfigured instance leads somebody to the wizard rather than to a
 *     sign-in page they cannot use
 *   - the wizard shuts behind itself, and stays shut
 *   - a port with no driver says so instead of showing a green tick
 *
 * This file runs before `registration-to-dashboard.spec.ts`, alphabetically
 * and by design: it leaves the instance configured and claimed, which is the
 * state that suite expects.
 *
 * It runs against its own database, prepared unconfigured, so that "clean
 * server" means what it says.
 */

// The whole run shares one page, because the wizard is a sequence and each
// step depends on the one before it.
test.describe.configure({ mode: "serial" });

const ADMIN = {
  name: "Grace Hopper",
  email: "grace@example.com",
  password: "correct-horse-battery-staple",
};

test("an unconfigured instance sends you to the wizard, not to sign in", async ({
  page,
}) => {
  // The first impression of a fresh deployment. Landing on a sign-in page with
  // no way to sign in is where the 30-minute budget usually goes.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole("heading", { name: "Set up OpenOKR" }),
  ).toBeVisible();
});

test("it reports the deployment honestly, including what is not built yet", async ({
  page,
}) => {
  await page.goto("/setup");

  // Tested, and true.
  await expect(page.getByText(/Database: Ready/)).toBeVisible();
  await expect(page.getByText(/PostgreSQL/)).toBeVisible();

  // Not tested, and said so rather than ticked. A green tick for an untested
  // connection is the fail-open shape this project has already been bitten by.
  await expect(page.getByText(/Chat channels: Not in this build/)).toBeVisible();
  await expect(page.getByText(/AI provider: Not in this build/)).toBeVisible();

  // No mail server is a working default, not a warning.
  await expect(page.getByText(/Mail: Ready/)).toBeVisible();
});

test("creating the first account finishes setup", async ({ page }) => {
  await page.goto("/setup/account");

  await page.getByLabel("What should this instance be called?").fill("Acme OKR");
  await page.getByLabel("Your name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  // Exact, because the reveal toggle beside it is named "Show password".
  const password = page.getByLabel("Password", { exact: true });
  await password.fill(ADMIN.password);

  // The reveal toggle. Somebody typing a 12-character minimum passphrase they
  // cannot see is the person most likely to mistype it and lock themselves out
  // of an instance that has no other admin yet.
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  // The value survives the switch, so the form still submits what was typed.
  await expect(password).toHaveValue(ADMIN.password);
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Finish setup" }).click();

  // Straight into the product, signed in, with a workspace already provisioned.
  await expect(page).toHaveURL(/\/$/);
  // The Work Map, since P3-T11 replaced the proving dashboard this used to
  // assert. The workspace switcher still carries the admin name.
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible();
  await expect(page.getByText(ADMIN.name).first()).toBeVisible();
});

test("the wizard is shut afterwards, and says why", async ({ page }) => {
  // The property that matters most here: a setup route that stayed open on a
  // running instance would let anybody who could reach it re-claim it.
  await page.goto("/setup");
  await expect(
    page.getByRole("heading", { name: "Setup is already done" }),
  ).toBeVisible();
  await expect(page.getByText(/already been set up/i)).toBeVisible();
});

test("the account step is shut too, not just the first page", async ({
  page,
}) => {
  // Guarded by the layout rather than the page, so every route under /setup is
  // covered by one check instead of one each.
  await page.goto("/setup/account");
  await expect(
    page.getByRole("heading", { name: "Setup is already done" }),
  ).toBeVisible();
});

test("registration is closed behind the first account", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByText(/invitation-only/i)).toBeVisible();
});

test("the admin can sign in again", async ({ page }) => {
  // The acceptance criterion's actual words: a secured instance with an admin
  // exists. Proven by signing in as them on a fresh browser context.
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  // Exact, because "Sign in with a passkey" is also a button on this page.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  // The Work Map, since P3-T11 replaced the proving dashboard this used to
  // assert. The workspace switcher still carries the admin name.
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible();
  await expect(page.getByText(ADMIN.name).first()).toBeVisible();
});
