/**
 * Where a sign-up's confirmation link lands (plan 0.8.0 S2, screen S-35).
 *
 * The suite's instance writes mail to its log, so it requires no confirmation
 * and sign-up signs a person straight in. The page is reached here the way
 * Better Auth reaches it: directly, with or without its `error`.
 */
import { expect, test } from "./fixtures.ts";

test("a confirmed address is welcomed and offered the sign-in", async ({
  page,
}) => {
  await page.goto("/email-confirmed");
  await expect(page.getByTestId("email-confirmed")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Welcome to / })).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("an expired link says so, and how long links last", async ({ page }) => {
  await page.goto("/email-confirmed?error=TOKEN_EXPIRED");
  await expect(
    page.getByRole("heading", { name: "This link has expired" }),
  ).toBeVisible();
  await expect(page.getByTestId("email-link-expired")).toContainText(
    "one hour",
  );
});

test("any other error is a link that is not valid", async ({ page }) => {
  await page.goto("/email-confirmed?error=INVALID_TOKEN");
  await expect(
    page.getByRole("heading", { name: "This link is not valid" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});
