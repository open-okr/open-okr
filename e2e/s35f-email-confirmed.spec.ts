/**
 * Where a sign-up's confirmation link lands (plan 0.8.0 S2, screen S-35), and
 * the form on it that asks for a new link (S3).
 *
 * The suite's instance writes mail to its log, so it requires no confirmation
 * and sign-up signs a person straight in. The page is reached here the way
 * Better Auth reaches it: directly, with or without its `error`. The resend
 * still answers on such an instance and queues nothing, which is what lets
 * the answer and the per-address wait be driven here; the mail itself is the
 * integration suite's and staging's (email-verification.md §6).
 */
import AxeBuilder from "@axe-core/playwright";
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
    "works for 24 hours",
  );
});

test("an expired link asks for a new one, and says the same whoever the address is", async ({
  page,
}) => {
  // An address nobody has, so the answer is the one a stranger would get.
  const email = `nobody-${Date.now()}@example.com`;
  await page.goto("/email-confirmed?error=TOKEN_EXPIRED");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send a new link" }).click();

  await expect(page.getByTestId("resend-answer")).toHaveText(
    `If ${email} has an account waiting to be confirmed, a new link is on its way. It works for 24 hours.`,
  );
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send a new link" }),
  ).toBeHidden();

  // A second request for the same address within the minute is held.
  await page.reload();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send a new link" }).click();
  await expect(page.getByTestId("resend-answer")).toHaveText(
    "Too many links have been asked for this address. Try again in 1 minute.",
  );
});

test("any other error is a link that is not valid", async ({ page }) => {
  await page.goto("/email-confirmed?error=INVALID_TOKEN");
  await expect(
    page.getByRole("heading", { name: "This link is not valid" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});

// s43 scans this page in its welcome state; the form is the expired one's.
test("the form for a new link has no serious accessibility findings", async ({
  page,
}) => {
  await page.goto("/email-confirmed?error=TOKEN_EXPIRED");
  await expect(
    page.getByRole("button", { name: "Send a new link" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const fatal = results.violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
    .map((violation) => `${violation.id}: ${violation.help}`);
  expect(fatal).toEqual([]);
});
