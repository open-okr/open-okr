/**
 * Deleting your own account, as a person sees it (screen S-51, docs/design/
 * account-deletion.md §8 and §9, plan 0.8.0 Y7).
 *
 * **A person of its own, invited through the product**, as
 * `s51-account-self-service` does: asking ends every session of the account,
 * which done to the shared account would sign out every spec after it on the
 * shard. A spec may rely on the claim and nothing else.
 *
 * The fourteen days, the run, the ledger and the notice are the integration
 * suite's (`packages/core/test/account-deletion.test.ts`), with a fake clock.
 * This is the card, its refusal, the confirmation, and the sign-in that keeps
 * the account.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { getStarted, signIn } from "./instance-account.ts";

const PERSON = {
  email: `leaving-${Date.now()}@example.com`,
  name: "Lee Leaving",
  password: "a passphrase I will keep",
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
  await getStarted(page);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
    timeout: 30_000,
  });
});

test("the only owner sees why not, with the handover, and no form", async ({
  page: ownerPage,
}) => {
  await signIn(ownerPage);
  await ownerPage.goto("/account");
  const card = ownerPage.getByTestId("delete-account-card");
  await expect(
    card.getByRole("heading", { name: "Delete your account" }),
  ).toBeVisible();
  await expect(card.getByTestId("delete-refusal")).toContainText(
    "You are the only owner of",
  );
  await expect(card.getByRole("link", { name: "Hand it over" })).toHaveAttribute(
    "href",
    "/admin/roles",
  );
  await expect(card.getByTestId("delete-account-form")).toHaveCount(0);
});

test("a wrong password is refused with its sentence, and nothing happens", async () => {
  await page.goto("/account");
  const card = page.getByTestId("delete-account-card");
  await expect(card.getByRole("link", { name: "Download it on Security" }))
    .toBeVisible();
  await card.getByLabel("Your password").fill("not my password at all");
  await card.getByRole("button", { name: "Delete my account" }).click();
  await expect(card.getByText("That password was not right.")).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
});

test("confirming signs them out and says the date", async () => {
  await page.goto("/account");
  const card = page.getByTestId("delete-account-card");
  await card.getByLabel("Your password").fill(PERSON.password);
  await card.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=deletion/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("deletion-requested")).toContainText(
    "Your account will be deleted on",
  );

  // Signed out everywhere: Your account sends them to sign in.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("signing in again keeps the account, and the page says so", async () => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(PERSON.email);
  await page.getByLabel("Password").fill(PERSON.password);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/account\?deletion=kept/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("deletion-kept")).toHaveText(
    "Your account is kept. Signing in cancelled the deletion you asked for, and nothing was deleted.",
  );
  // The card offers the form again.
  await expect(
    page.getByTestId("delete-account-card").getByLabel("Your password"),
  ).toBeVisible();
});
