/**
 * The field kit on the authentication screens (S-35, docs/design/
 * guided-inputs.md §4.4 and §4.11).
 *
 * **A malformed address was told a link was on its way.** The browser's own
 * `type="email"` accepts `priya@northwind`, Better Auth refused it, and the
 * forgot-password page treated every refusal but a rate limit as sent. The
 * email field now checks with the server's own rule, says what is wrong when
 * the person leaves it, and stops the form before anything is sent.
 *
 * Signed out, in a context of its own, because these are the screens a person
 * sees before they have an account.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo } from "./instance-account.ts";

const MALFORMED = "Check the address. It needs a name, an @ and a domain";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

/** Fills a field, retried because a fill before hydration is undone by it. */
async function type(label: string, value: string): Promise<void> {
  await expect(async () => {
    await page.getByLabel(label, { exact: true }).fill(value);
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });
}

test("a malformed address is stopped before it is sent", async () => {
  await goTo(page, "/forgot-password");
  await type("Email", "priya@northwind");
  await page.keyboard.press("Tab");

  // Said beside the field once the person leaves it.
  await expect(page.getByText(MALFORMED)).toBeVisible({ timeout: 10_000 });

  // And the form does not go: the page still asks for an address rather than
  // saying a link is on its way.
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(
    0,
  );
});

test("a whole address goes through", async () => {
  await type("Email", "priya@northwind.example");
  await page.keyboard.press("Tab");
  await expect(page.getByText(MALFORMED)).toHaveCount(0);

  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("the password on the sign-in screen can be shown before it is sent", async () => {
  await goTo(page, "/sign-in");
  const password = page.getByLabel("Password", { exact: true });
  await type("Password", "a passphrase to check");

  const reveal = page.getByRole("button", { name: "Show what you typed" });
  await expect(password).toHaveAttribute("type", "password");
  await reveal.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(reveal).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveValue("a passphrase to check");
});
