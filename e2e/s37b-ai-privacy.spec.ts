/**
 * The AI console's privacy and egress card (AI-NATIVE-PLAN §4, completeness
 * review M-10).
 *
 * Acceptance criterion:
 *   Given an administrator on the AI console, when they narrow what may be
 *   sent, list the hosts a request may reach and save, then the card reads
 *   the same after a reload, and a host that is not one is refused by name.
 *
 * The card was three paragraphs of static text. What the controls do to a
 * request is proved where they are enforced, in
 * `packages/adapters/test/ai-egress.test.ts`, and the save against a database
 * in `packages/core/test/ai-privacy.test.ts`. What only a browser proves is
 * that the form an administrator actually meets posts and reads back.
 *
 * **No provider is configured on the end-to-end instance**, so the card is
 * editable: it is greyed out only when every tier is answered locally. The
 * controls are put back to their defaults in `afterAll`, whatever happened in
 * between, because the suite shares one workspace.
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/** The privacy card's own form, not one of the console's other Save buttons. */
const card = (page: Page): Locator =>
  page.locator("form").filter({ has: page.getByText("What may be sent") });

async function save(page: Page): Promise<void> {
  await card(page).getByRole("button", { name: "Save" }).click();
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await goTo(page, "/admin/ai");
  const form = card(page);
  await form.getByLabel("Everything a feature needs").check();
  await form
    .getByLabel(
      "Replace email addresses and phone numbers before anything is sent",
    )
    .check();
  await form
    .getByLabel("Ask the provider not to keep or train on what is sent")
    .uncheck();
  await form.getByLabel("Hosts an AI request may reach").fill("");
  await save(page);
  await expect(form.getByRole("status")).toHaveText("Saved.", {
    timeout: 15_000,
  });
  await context?.close();
});

test("a fresh workspace sends what features need, with addresses replaced", async () => {
  await goTo(page, "/admin/ai");
  await expect(
    page.getByRole("heading", { level: 2, name: "Privacy and egress" }),
  ).toBeVisible();
  const form = card(page);
  await expect(form.getByLabel("Everything a feature needs")).toBeChecked();
  await expect(
    form.getByLabel(
      "Replace email addresses and phone numbers before anything is sent",
    ),
  ).toBeChecked();
  await expect(
    form.getByLabel("Ask the provider not to keep or train on what is sent"),
  ).not.toBeChecked();
  await expect(form.getByLabel("Hosts an AI request may reach")).toHaveValue(
    "",
  );
});

test("a narrowed card is what the page reads after a reload", async () => {
  await goTo(page, "/admin/ai");
  const form = card(page);
  await form.getByLabel("Assists only").check();
  await form
    .getByLabel("Ask the provider not to keep or train on what is sent")
    .check();
  await form
    .getByLabel("Hosts an AI request may reach")
    .fill("https://openrouter.ai/api/v1\napi.anthropic.com");
  await save(page);
  await expect(form.getByRole("status")).toHaveText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/ai");
  const reloaded = card(page);
  await expect(reloaded.getByLabel("Assists only")).toBeChecked();
  await expect(
    reloaded.getByLabel("Ask the provider not to keep or train on what is sent"),
  ).toBeChecked();
  // A pasted address is kept as the host the guard compares.
  await expect(
    reloaded.getByLabel("Hosts an AI request may reach"),
  ).toHaveValue("openrouter.ai\napi.anthropic.com");
});

test("a host that is not one is refused by name, and nothing changes", async () => {
  await goTo(page, "/admin/ai");
  const form = card(page);
  await form.getByLabel("Hosts an AI request may reach").fill("not_a_host!");
  await save(page);
  await expect(form.getByRole("alert")).toContainText(
    "not_a_host! is not a host name",
    { timeout: 15_000 },
  );

  await goTo(page, "/admin/ai");
  await expect(
    card(page).getByLabel("Hosts an AI request may reach"),
  ).toHaveValue("openrouter.ai\napi.anthropic.com");
});
