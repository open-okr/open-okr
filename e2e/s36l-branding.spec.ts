/**
 * The branding card (UIUX-PLAN.md §6 S-36, completeness review M-14).
 *
 * Acceptance criterion:
 *   Given an administrator who saves a brand colour, when any screen of the
 *   workspace renders, then the brand tokens are drawn in that colour, in light
 *   and dark, and the card says which shade is in force.
 *
 * The card saved a colour and said it was "in force across this workspace"
 * while every screen stayed indigo. The derivation and its contrast are proved
 * in `packages/core/test/brand-colour.test.ts`, and the card's save and read
 * back in `apps/web/test/brand-colour.test.ts`. What only a browser proves is
 * the last step: that the style sheet the root layout sets actually wins over
 * `tokens.css` on the page a member is looking at, in both themes.
 *
 * **The colour is reset in `afterAll`**, whatever happened in between. The
 * suite runs on one workspace, and s43-accessibility scans every screen
 * against the product's own palette after this file.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/** A brand token as the browser resolved it on the root element. */
const token = (page: Page, name: string) =>
  page.evaluate(
    (property) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(property)
        .trim()
        .toLowerCase(),
    name,
  );

const field = (page: Page) => page.locator("input[name='primaryColor']");

async function save(page: Page, colour: string): Promise<void> {
  await field(page).fill(colour);
  await page.getByRole("button", { name: "Save" }).click();
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await goTo(page, "/admin/branding");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(
    page.getByText("Back to the product’s own colour."),
  ).toBeVisible({ timeout: 15_000 });
  await context?.close();
});

test("a fresh workspace is drawn in the product's own indigo", async () => {
  await goTo(page, "/admin/branding");
  await expect(
    page.getByRole("heading", { level: 1, name: "Branding" }),
  ).toBeVisible();
  expect(await token(page, "--brand")).toBe("#4f46e5");
  await expect(
    page.getByText("Empty uses the product’s own theme."),
  ).toBeVisible();
});

test("a saved colour is what every screen is drawn in", async () => {
  await save(page, "#7c3aed");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("#7c3aed is in force on every screen"),
  ).toBeVisible();

  // Another screen, loaded fresh, so the colour is the layout's rather than
  // anything the card left behind.
  await goTo(page, "/spaces");
  expect(await token(page, "--brand")).toBe("#7c3aed");

  // Dark lifts the text stop and keeps the fill, as tokens.css does.
  const lightText = await token(page, "--brand-text");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  expect(await token(page, "--brand")).toBe("#7c3aed");
  expect(await token(page, "--brand-text")).not.toBe(lightText);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
});

test("a status hue is refused in words, and nothing changes", async () => {
  await goTo(page, "/admin/branding");
  await save(page, "#22c55e");

  // Filtered, because Next's route announcer is an alert region too.
  const refusal = page.getByRole("alert").filter({ hasText: "reads as green" });
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  // Refused means kept in the field, under the sentence saying why.
  await expect(field(page)).toHaveValue("#22c55e");

  await goTo(page, "/admin/branding");
  expect(await token(page, "--brand")).toBe("#7c3aed");
});

test("a colour too light for white text is darkened, and the card says so", async () => {
  await goTo(page, "/admin/branding");
  await save(page, "#c7d2fe");
  await expect(
    page.getByText("#c7d2fe is too light to carry white text"),
  ).toBeVisible({ timeout: 15_000 });

  // Loaded fresh, so the fill is the new one rather than the violet before it.
  await goTo(page, "/admin/branding");
  const fill = await token(page, "--brand");
  expect(fill).not.toBe("#c7d2fe");
  expect(fill).not.toBe("#7c3aed");
  expect(fill).toMatch(/^#[0-9a-f]{6}$/);
});
