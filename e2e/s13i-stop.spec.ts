/**
 * Stopping an OKR from the list (P9-T13-c-a, METHOD.md §2.9).
 *
 * Acceptance:
 *   Given an objective that no longer matters, when it is stopped from the
 *   list with a reason, then it is closed as abandoned with that reason, and
 *   Undo reopens it.
 *
 * NW-Q2-10's stop: C4, "Expansion comes from accounts that reached value".
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const EXPANSION = `Expansion comes from accounts that reached value ${STAMP}`;
const REASON = "Capacity moves to the competitive response";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let goalId = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");
const row = () =>
  main()
    .locator(`input[aria-label="Objective title"][value="${EXPANSION}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");

async function readGoal(): Promise<{
  closedAt: string | null;
  closeDecision: string | null;
}> {
  const response = await api.get(`/api/v1/goals/read?id=${goalId}`, {
    headers: authed(),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token && goalId) {
    await api.post("/api/v1/goals/delete", {
      headers: authed(),
      data: { id: goalId },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, and an objective that will stop mattering", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Stop e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const cycle = (await (
    await api.get("/api/v1/cycles/current?mode=quarterly", {
      headers: authed(),
    })
  ).json()).data as { id: string };
  const response = await api.post("/api/v1/goals/create", {
    headers: authed(),
    data: { title: EXPANSION, cycleId: cycle.id, level: "company" },
  });
  expect(response.status()).toBe(200);
  goalId = (await response.json()).data.id;
});

test("acceptance: stopped from the list with a reason, it closes as abandoned, and Undo reopens it", async () => {
  await goTo(page, "/goals");
  await expect(row()).toBeVisible({ timeout: 15_000 });

  await row().hover();
  await row().getByRole("button", { name: `Stop ${EXPANSION}` }).click();
  const reason = row().getByRole("textbox", {
    name: "Why it no longer matters",
  });
  await expect(reason).toBeFocused();
  // No reason, no stop: the control waits for the one line.
  await expect(row().getByRole("button", { name: "Stop", exact: true }))
    .toBeDisabled();
  await reason.fill(REASON);
  await row().getByRole("button", { name: "Stop", exact: true }).click();

  await expect(row()).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(async () => (await readGoal()).closeDecision, { timeout: 15_000 })
    .toBe("abandon");

  await page
    .getByTestId("toast")
    .filter({ hasText: "Objective stopped" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(row()).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await readGoal()).closedAt, { timeout: 15_000 })
    .toBeNull();
});
