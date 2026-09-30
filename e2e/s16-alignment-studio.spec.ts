/**
 * A dependency is added and taken apart in the alignment studio (S-16,
 * completeness review M-35).
 *
 * Linking two goals was one click and undoing it had no screen at all:
 * `goals.removeDependency` was excused by the action-coverage test as "removed
 * through the studio's own canvas write", which no write was. The details
 * panel now lists the selected goal's dependencies by title, each with its
 * Remove, and this walks both halves in a browser.
 *
 * It uses the first two goals the canvas draws, which earlier specs in this
 * suite have created, and leaves no dependency behind.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

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

test("two goals are linked on the canvas and unlinked from the panel", async () => {
  await goTo(page, "/goals/studio");
  const cards = page.locator("button[id^='studio-node-']");
  await expect(cards.nth(1)).toBeVisible({ timeout: 15_000 });

  const first = cards.nth(0);
  const second = cards.nth(1);
  // The card's title, the first line of text it draws.
  const secondTitle = (
    await second.locator("span.line-clamp-2").innerText()
  ).trim();

  await page.getByRole("button", { name: "Link two goals" }).click();
  await first.click();
  await second.click();

  // Selecting the first goal shows its dependency by the other's title.
  await first.click();
  const remove = page.getByRole("button", {
    name: `Remove the dependency on ${secondTitle}`,
  });
  await expect(remove).toBeVisible({ timeout: 15_000 });

  await remove.click();
  await expect(remove).toHaveCount(0, { timeout: 15_000 });
});
