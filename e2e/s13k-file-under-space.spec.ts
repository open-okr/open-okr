/**
 * Filing a new objective under a space from the drafting surface (UAT
 * BUG-014).
 *
 * Every objective drafted on phase 4 used to belong to the workspace, so a
 * space's sessions, page and alignment picture never saw one. "Open drafting"
 * on a space now carries the space into phase 4, the form starts on it, and
 * the objective is filed there. Who may file where is proved against the
 * database in `goal-space-filing.test.ts`.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const SPACE = `Onboarding ${STAMP}`;
const TITLE = `New customers finish onboarding on their own ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let spaceId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token && spaceId) {
    const { data } = await (
      await api.get(`/api/v1/goals/list?spaceId=${spaceId}`, {
        headers: authed(),
      })
    ).json();
    for (const goal of (data?.goals ?? []) as { id: string }[]) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goal.id },
      });
    }
    await api.post("/api/v1/spaces/archive", {
      headers: authed(),
      data: { id: spaceId },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with an empty space", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Filing e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const response = await api.post("/api/v1/spaces/create", {
    headers: authed(),
    data: { name: SPACE },
  });
  expect(response.status()).toBe(200);
  spaceId = (await response.json()).data.id;
});

test("acceptance: Open drafting on the space files the new objective under it", async () => {
  await goTo(page, `/spaces/${spaceId}`);
  const open = page.getByRole("link", { name: "Open drafting" });
  await expect(open).toHaveAttribute("href", `/cycle?phase=4&space=${spaceId}`);
  await open.click();
  await page.waitForURL(/phase=4/);

  const space = page.locator("#goal-space");
  await expect(space).toBeVisible({ timeout: 15_000 });
  await expect(space.locator("option:checked")).toHaveText(`Space: ${SPACE}`);

  await page.locator("#goal-title").fill(TITLE);
  await page.getByRole("button", { name: "Add objective" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await (
          await api.get(`/api/v1/goals/list?spaceId=${spaceId}`, {
            headers: authed(),
          })
        ).json();
        return ((data?.goals ?? []) as { title: string }[]).map(
          (goal) => goal.title,
        );
      },
      { timeout: 15_000 },
    )
    .toContain(TITLE);
});
