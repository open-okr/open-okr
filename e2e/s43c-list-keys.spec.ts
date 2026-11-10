/**
 * The list and detail keys on the OKRs list and a goal page (UIUX-PLAN §4,
 * the Keyboard row; plan 0.7.0, U2).
 *
 * Acceptance:
 *   Given the OKRs list, when `j` is pressed, then the focus lands on a row's
 *   open link rather than in its title field; and `e` then puts the caret in
 *   that row's title.
 *   Given a goal page with a neighbour in its cycle, when `]` or `[` is
 *   pressed, then the neighbour's page opens.
 *
 * Makes its own two objectives, so it relies on the claim and nothing else.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const TITLES = [
  `Keys walk the list first ${STAMP}`,
  `Keys walk the list second ${STAMP}`,
];

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
const goalIds: string[] = [];

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  for (const id of goalIds) {
    await api.post("/api/v1/goals/delete", {
      headers: authed(),
      data: { id },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, and two objectives in the current quarter", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("List keys e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const cycle = (
    await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()
  ).data as { id: string };
  for (const title of TITLES) {
    const response = await api.post("/api/v1/goals/create", {
      headers: authed(),
      data: { title, cycleId: cycle.id, level: "company" },
    });
    expect(response.status()).toBe(200);
    goalIds.push((await response.json()).data.id);
  }
});

test("acceptance: j lands on a row's open link, and e puts the caret in its title", async () => {
  await goTo(page, "/goals");
  await expect(
    page.getByRole("textbox", { name: "Objective title" }).first(),
  ).toBeVisible({ timeout: 15_000 });
  // Nothing focused yet, so the first j takes the first row.
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  await page.keyboard.press("j");
  const landed = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName ?? "",
      href: active?.getAttribute("href") ?? "",
    };
  });
  expect(landed.tag).toBe("A");
  expect(landed.href).toMatch(/^\/goals\/[0-9a-f-]{36}$/);

  await page.keyboard.press("e");
  const editing = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? "",
    label: document.activeElement?.getAttribute("aria-label") ?? "",
  }));
  expect(editing.tag).toBe("TEXTAREA");
  expect(editing.label).toMatch(/title/i);
});

test("acceptance: ] or [ on a goal page opens its neighbour in the cycle", async () => {
  await goTo(page, `/goals/${goalIds[0]}`);
  await expect(
    page.getByRole("heading", { level: 1, name: TITLES[0] }),
  ).toBeVisible({ timeout: 15_000 });

  // Two objectives in the cycle at least, so one neighbour or the other.
  const next = page.getByRole("link", { name: /Next objective/ });
  const previous = page.getByRole("link", { name: /Previous objective/ });
  const useNext = (await next.count()) > 0;
  const link = useNext ? next : previous;
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/goals\/[0-9a-f-]{36}$/);

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press(useNext ? "]" : "[");
  await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 15_000 });
});
