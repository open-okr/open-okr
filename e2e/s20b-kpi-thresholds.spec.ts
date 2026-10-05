/**
 * A KPI judged in its own units (P9-T17a, METHOD.md §6.2, §6.4).
 *
 * Acceptance:
 *   Given uptime at or above 99.9 with a red boundary at 99.5, when three
 *   months read 99.95, 99.7 and 95, then the grid colours them healthy,
 *   watch and unhealthy. The ratio to target called 95 healthy.
 *
 * KPIs cannot be deleted, so this one stays; its title is stamped, and it has
 * one unhealthy month, which is short of the two a recovery proposal waits
 * for.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const TITLE = `Uptime ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

/** The fifth of the month `back` months before this one, as a local date. */
function monthsAgo(back: number): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 5));
  return at.toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test("sign in, with an uptime KPI and three months of readings", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("KPI thresholds e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const kpi = await post<{ id: string }>("kpis.create", {
    title: TITLE,
    frequency: "monthly",
    unit: "%",
    targetType: "at_least",
    targetDefault: 99.9,
    greenLow: 99.9,
    redLow: 99.5,
  });
  for (const [back, actualValue] of [
    [3, 99.95],
    [2, 99.7],
    [1, 95],
  ] as const) {
    await post("kpis.record", {
      kpiId: kpi.id,
      on: monthsAgo(back),
      actualValue,
    });
  }
});

test("acceptance: each month is coloured by its own band", async () => {
  await goTo(page, "/kpis");
  const row = page.locator("tr").filter({ hasText: TITLE });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const bands = await row
    .locator("td[data-band]")
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-band")));
  // Oldest first, as the grid reads left to right.
  expect(bands).toEqual(["healthy", "watch", "unhealthy"]);
});
