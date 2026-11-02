/**
 * The workspace's logo and favicon (docs/design/workspace-logo-favicon.md §6).
 *
 * Acceptance criteria:
 *   Given an administrator on Branding, when they choose an image, then a
 *   preview shows it before anything is uploaded; Cancel forgets it.
 *   Given the preview, when they press the page's one Save, then the sidebar draws the logo and
 *   the tab icon is the workspace's favicon.
 *   Given an SVG, when it is chosen, then it is refused and nothing previews.
 *   Given a stored logo, when it is removed, then the initials return.
 *
 * Everything is removed at the end, because the instance is shared with every
 * spec after this one.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/** The 12 by 8 JPEG `s33-people` uploads, so the suite holds no binary file. */
const PICTURE = Buffer.from(
  "/9j/4QEqRXhpZgAASUkqAAgAAAAJAA8BAgALAAAAkgAAABABAgAIAAAAigAAABIBAwABAAAAAQAAABoBBQABAAAAegAAABsBBQABAAAAggAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAngAAACWIBAABAAAA7AAAAAAAAAA4YwAA6AMAADhjAADoAwAATGVha3kgMQBNMjRUZXN0Q2FtAAAGAACQBwAEAAAAMDIxMAGRBwAEAAAAAQIDAACgBwAEAAAAMDEwMAGgAwABAAAA//8AAAKgBAABAAAADAAAAAOgBAABAAAACAAAAAAAAAACAAEAAgACAAAATgAAAAIABQADAAAACgEAAAAAAAADAAAAAQAAAAgAAAABAAAAAAAAAAEAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAwDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIgD4t//2Q==",
  "base64",
);

const logoCard = () => page.getByTestId("branding-logo");
const saved = () =>
  page
    .getByTestId("branding-mirror")
    .getByRole("status")
    .filter({ hasText: "Saved." });
const faviconCard = () => page.getByTestId("branding-favicon");

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await goTo(page, "/admin/branding");
  for (const card of [logoCard(), faviconCard()]) {
    const remove = card.getByRole("button", { name: "Remove" });
    if (await remove.isVisible()) {
      await remove.click();
      await expect(card.getByRole("status")).toBeVisible({ timeout: 15_000 });
    }
  }
  await context?.close();
});

test("a chosen logo is previewed before anything is sent, and Cancel forgets it", async () => {
  await goTo(page, "/admin/branding");
  await logoCard()
    .getByLabel("Choose an image")
    .setInputFiles({ name: "mark.jpg", mimeType: "image/jpeg", buffer: PICTURE });
  const preview = page.getByTestId("branding-logo-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/mark\.jpg, \d+ KB/)).toBeVisible();
  // The page's mirror draws it in both themes before anything is sent
  // (docs/design/branding-page.md §3).
  const mirror = page.getByTestId("branding-mirror");
  await expect(mirror.getByText("Light theme")).toBeVisible();
  await expect(mirror.getByText("Dark theme")).toBeVisible();
  await expect(mirror.locator("img[src^='blob:']")).toHaveCount(2);
  await expect(page.getByTestId("branding-mirror-unsaved")).toHaveText(
    "Not saved yet: logo",
  );

  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("branding-mirror-unsaved")).toHaveText("");
});

test("an SVG is refused and nothing is previewed", async () => {
  await logoCard()
    .getByLabel("Choose an image")
    .setInputFiles({
      name: "mark.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    });
  await expect(logoCard().getByRole("alert")).toContainText("SVG");
  await expect(page.getByTestId("branding-logo-preview")).toHaveCount(0);
});

test("a saved logo is the sidebar's brandmark", async () => {
  await logoCard()
    .getByLabel("Choose an image")
    .setInputFiles({ name: "mark.jpg", mimeType: "image/jpeg", buffer: PICTURE });
  // One Save for the whole look, under the preview
  // (docs/design/branding-page.md §3).
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(saved()).toBeVisible({ timeout: 15_000 });

  await page.reload();
  const logo = page.getByTestId("workspace-logo");
  await expect(logo).toBeVisible({ timeout: 15_000 });
  const response = await page.request.get(
    (await logo.getAttribute("src")) ?? "",
  );
  expect(response.status()).toBe(200);
});

test("a saved favicon is the tab icon on signed-in screens", async () => {
  await faviconCard()
    .getByLabel("Choose an image")
    .setInputFiles({ name: "tab.jpg", mimeType: "image/jpeg", buffer: PICTURE });
  await expect(page.getByText("Browser tab, at 16 and 32 pixels")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(saved()).toBeVisible({ timeout: 15_000 });

  await goTo(page, "/");
  await expect(page.locator("link[rel='icon'][href*='/api/blobs/']")).toHaveCount(
    1,
  );
  // The only icon linked: a browser picks the product's sized icon over it
  // when both are there, and the tab never changes.
  await expect(page.locator("link[rel~='icon']")).toHaveCount(1);
});

test("a removed logo gives the sidebar its initials back", async () => {
  await goTo(page, "/admin/branding");
  await logoCard().getByRole("button", { name: "Remove" }).click();
  await expect(logoCard().getByRole("status")).toContainText("Removed", {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByTestId("workspace-logo")).toHaveCount(0);
});
