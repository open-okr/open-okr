/**
 * A member's own AI key (completeness review M-36, P2-T14, AI-NATIVE-PLAN
 * §3.3).
 *
 * Acceptance criterion, P2-T14's own:
 *   Given a workspace key and a personal key, when the member runs an assist,
 *   then their own key is used, and an admin cannot read it.
 *
 * Which key a request uses is proved where it is decided, in
 * `packages/core/test/ai-personal-key.test.ts` against a database and in
 * `apps/web/test/personal-ai-key-precedence.test.ts` on the mock driver: the
 * end-to-end instance has no provider a request could reach. What only a
 * browser proves is the screen a member actually meets: that an administrator
 * opening a provider to personal keys gives the member a slot, that the key
 * goes in once and never comes back out, that a malformed one is refused by
 * the form, and that removing it works.
 *
 * **The provider is opened to personal keys and never switched on**, so AI
 * stays off for every other spec, which assumes it is. `afterAll` closes it
 * again whatever happened in between, because the suite shares one workspace.
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const KEY = "sk-or-v1-e2e-personal-key-M36q";
const HINT = "••••M36q";

let context: BrowserContext;
let page: Page;

/** OpenRouter's settings form on the AI console, not its key form. */
const providerForm = (page: Page): Locator =>
  page.locator(
    'form:has(input[name="provider"][value="openrouter"]):has(input[name="allowUserKeys"])',
  );

/** The OpenRouter slot on the member's own screen. */
const slot = (page: Page): Locator =>
  page.getByTestId("personal-key").filter({
    has: page.getByRole("heading", { level: 2, name: "OpenRouter" }),
  });

async function allowPersonalKeys(page: Page, allow: boolean): Promise<void> {
  await goTo(page, "/admin/ai");
  const form = providerForm(page);
  const box = form.getByLabel("Let members supply their own key");
  if (allow) {
    await box.check();
  } else {
    await box.uncheck();
  }
  // Left off: a provider that takes personal keys and is not in use keeps AI
  // off for every other spec.
  await expect(form.getByLabel("Use this provider")).not.toBeChecked();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.", {
    timeout: 15_000,
  });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await goTo(page, "/account/ai");
  const remove = slot(page).getByRole("button", { name: "Remove my key" });
  if ((await remove.count()) > 0) {
    await remove.click();
    await expect(slot(page).getByText("Not stored")).toBeVisible({
      timeout: 15_000,
    });
  }
  await allowPersonalKeys(page, false);
  await context?.close();
});

test("with no provider taking personal keys, the screen says so and who can change it", async () => {
  await goTo(page, "/account/ai");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your AI keys" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("personal-keys-empty")).toBeVisible();
  await expect(page.locator('input[name="apiKey"]')).toHaveCount(0);
});

test("an administrator opening a provider gives the member a slot for it", async () => {
  await allowPersonalKeys(page, true);

  await goTo(page, "/account/ai");
  const card = slot(page);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Not stored")).toBeVisible();
});

test("a key goes in once, and only its last four characters come back", async () => {
  await goTo(page, "/account/ai");
  const card = slot(page);
  const field = card.getByLabel(/Paste your key for OpenRouter/);
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(KEY);
  await card.getByRole("button", { name: "Store" }).click();

  await expect(card.getByRole("status")).toContainText(
    "Stored. Your next request to OpenRouter uses it.",
    { timeout: 15_000 },
  );
  await expect(card.getByText(HINT)).toBeVisible();
  await expect(card.getByText("Stored", { exact: true })).toBeVisible();
  // The field is empty again, and nowhere on the page holds the key.
  await expect(card.locator('input[name="apiKey"]')).toHaveValue("");
  expect(await page.content()).not.toContain(KEY);

  // And after a reload, which is the read rather than the write's answer.
  await goTo(page, "/account/ai");
  await expect(slot(page).getByText(HINT)).toBeVisible({ timeout: 15_000 });
  expect(await page.content()).not.toContain(KEY);
});

test("a malformed key is refused by the form, and the stored one stays", async () => {
  await goTo(page, "/account/ai");
  const card = slot(page);
  await card.getByLabel(/Paste a new key for OpenRouter/).fill("sk-or has a space");
  await card.getByRole("button", { name: "Replace" }).click();

  await expect(card.getByRole("alert")).toContainText(
    "That is not a key this can store.",
    { timeout: 15_000 },
  );
  await expect(card.getByRole("alert")).not.toContainText("has a space");
  await expect(card.getByText(HINT)).toBeVisible();
});

test("the AI console never shows it, even to the administrator who owns it", async () => {
  await goTo(page, "/admin/ai");
  await expect(
    page.getByRole("heading", { level: 1, name: "AI" }),
  ).toBeVisible({ timeout: 15_000 });
  const html = await page.content();
  expect(html).not.toContain(KEY);
  expect(html).not.toContain(HINT);
});

test("removing it leaves the slot empty", async () => {
  await goTo(page, "/account/ai");
  const card = slot(page);
  await card.getByRole("button", { name: "Remove my key" }).click();

  // The chip is the confirmation. The Remove form goes with the key, so a
  // message inside it would be unmounted by the same render that proves it.
  await expect(card.getByText("Not stored")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(HINT)).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Remove my key" }),
  ).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Store" })).toBeVisible();
});
