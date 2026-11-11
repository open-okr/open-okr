/**
 * Your account, the parts a person changes about themselves (screens S-51
 * and S-35, docs/design/account-self-service.md §9, plan 0.8.0 Y3).
 *
 * **A person of its own, invited through the product.** Every other spec
 * signs in as the account that claimed the instance, and this one changes a
 * password: doing that to the shared account would break every spec after it
 * on the shard. So the owner invites somebody, as `s42b-ordinary-member` does,
 * and everything here happens to them. A spec may rely on the claim and
 * nothing else, and this relies on nothing else.
 *
 * The integration suite (`packages/core/test/password-change.test.ts`) holds
 * the rows and the mail; this is what a person sees.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { signIn } from "./instance-account.ts";

const PERSON = {
  email: `self-service-${Date.now()}@example.com`,
  name: "Sam Self-Service",
  password: "a first passphrase of mine",
  newPassword: "a second and better passphrase",
};

test.describe.configure({ mode: "serial" });

let person: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  person = await browser.newContext();
  page = await person.newPage();
});

test.afterAll(async () => {
  await person?.close();
});

test("the owner invites somebody, and they join", async ({
  page: ownerPage,
}) => {
  // The join drives a server action, a sign-up that provisions inside its own
  // hooks, and the first render of the shell, as `s42b` records.
  test.setTimeout(120_000);
  await signIn(ownerPage);
  await expect(async () => {
    await ownerPage.goto("/admin/invitations");
    await expect(
      ownerPage.getByLabel("Email address", { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await ownerPage
    .getByLabel("Email address", { exact: true })
    .fill(PERSON.email);
  await ownerPage
    .getByRole("button", { name: "Create the invitation" })
    .click();
  const link = ownerPage.getByTestId("invite-link");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const url = (await link.textContent())?.trim() ?? "";
  const token = url.slice(url.lastIndexOf("/") + 1);

  await page.goto(`/join/${token}`);
  await expect(
    page.getByRole("heading", { name: /You have been invited/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(PERSON.name);
  await page.getByLabel("Email").fill(PERSON.email);
  await page.getByLabel("Password", { exact: true }).fill(PERSON.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
    timeout: 30_000,
  });
});

test("a wrong current password is refused with its sentence", async () => {
  await page.goto("/account/security");
  const card = page.getByTestId("password-card");
  await expect(card.getByRole("heading", { name: "Password" })).toBeVisible();
  await card.getByLabel("Current password").fill("not my password at all");
  await card
    .getByLabel("New password", { exact: true })
    .fill(PERSON.newPassword);
  await card.getByLabel("New password again").fill(PERSON.newPassword);
  await card.getByRole("button", { name: "Change password" }).click();
  await expect(card.getByText("That password was not right.")).toBeVisible();
});

test("the two new passwords must match, before anything is sent", async () => {
  const card = page.getByTestId("password-card");
  await card.getByLabel("Current password").fill(PERSON.password);
  await card
    .getByLabel("New password", { exact: true })
    .fill(PERSON.newPassword);
  await card.getByLabel("New password again").fill(`${PERSON.newPassword}!`);
  await card.getByRole("button", { name: "Change password" }).click();
  await expect(
    card.getByText("The two new passwords are not the same."),
  ).toBeVisible();
});

test("the password changes, other devices are signed out, and the new one signs in", async () => {
  const card = page.getByTestId("password-card");
  await card.getByLabel("Current password").fill(PERSON.password);
  await card
    .getByLabel("New password", { exact: true })
    .fill(PERSON.newPassword);
  await card.getByLabel("New password again").fill(PERSON.newPassword);
  await expect(
    card.getByRole("checkbox", { name: /Sign out my other devices/ }),
  ).toBeChecked();
  await card.getByRole("button", { name: "Change password" }).click();
  await expect(card.getByRole("status")).toContainText(
    "Your password is changed. Your other devices are signed out. API tokens and connected apps keep working.",
  );
  // This browser stayed signed in.
  await page.goto("/account/security");
  await expect(page.getByTestId("password-card")).toBeVisible();

  // Signed out, the old password no longer works and the new one does.
  await person.clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(PERSON.email);
  await page.getByLabel("Password").fill(PERSON.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Those details did not match. Check them and try again.",
  );
  await page.getByLabel("Password").fill(PERSON.newPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
    timeout: 20_000,
  });
});
