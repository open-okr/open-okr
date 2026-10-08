/**
 * The general admin card refuses in words (S-36).
 *
 * **A mistyped timezone or domain sent the administrator to the error page.**
 * The save caught `OperationError` and threw everything else on, and both
 * values fail the action's input schema with an error that is not one. What
 * `apps/web/test/general-settings.test.ts` proves without a browser is the
 * sentence; what only a browser can show is that the administrator stays on
 * the card, reads it there, and finds nothing changed.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const DOMAIN_FIELD = "Trusted email domains (comma-separated)";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

const generalForm = () =>
  page.locator("form", { has: page.getByLabel("Timezone") });

/** Fills a field, retried because a fill before hydration is undone by it. */
async function type(label: string, value: string): Promise<void> {
  await expect(async () => {
    await page.getByLabel(label).fill(value);
    await expect(page.getByLabel(label)).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test("a timezone the server does not know is refused on the card", async () => {
  await goTo(page, "/admin/general");
  const before = await page.getByLabel("Timezone").inputValue();

  await type("Timezone", "Mars/Olympus_Mons");
  await generalForm().getByRole("button", { name: "Save", exact: true }).click();

  await expect(generalForm().getByRole("alert")).toContainText(
    "Mars/Olympus_Mons is not a timezone this server knows",
    { timeout: 10_000 },
  );
  // Still the card, not the error page, and what was typed is still there to
  // correct.
  await expect(page.getByLabel("Timezone")).toHaveValue("Mars/Olympus_Mons");

  await goTo(page, "/admin/general");
  await expect(page.getByLabel("Timezone")).toHaveValue(before, {
    timeout: 10_000,
  });
});

test("an entry that is not a domain is refused, and named", async () => {
  await goTo(page, "/admin/general");
  const before = await page.getByLabel(DOMAIN_FIELD).inputValue();

  await type(DOMAIN_FIELD, "priya@northwind");
  await generalForm().getByRole("button", { name: "Save", exact: true }).click();

  await expect(generalForm().getByRole("alert")).toContainText(
    "priya@northwind is not a domain",
    { timeout: 10_000 },
  );

  await goTo(page, "/admin/general");
  await expect(page.getByLabel(DOMAIN_FIELD)).toHaveValue(before, {
    timeout: 10_000,
  });
});
