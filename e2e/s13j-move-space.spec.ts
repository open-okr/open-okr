/**
 * Moving an objective to another space from the list (P9-T13a, METHOD.md
 * §2.9, NW-Q3-07).
 *
 * Support merges into Customer Success, and Elena moves SU1 there from the
 * OKR list. Its check-ins, dependency and alignment going with it is proved
 * against the database in `goal-move.test.ts`; this is the control, and the
 * move landing.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const SU1 = `Every customer question answered the same day ${STAMP}`;
const SUPPORT = `Support ${STAMP}`;
const SUCCESS = `Customer Success ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let goalId = "";
const spaceIds: string[] = [];

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action} answered`).toBe(200);
  return (await response.json()).data as T;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    if (goalId) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goalId },
      });
    }
    for (const id of spaceIds) {
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id },
      });
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with SU1 in Support", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Move e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const cycleId = (
    (await (
      await api.get("/api/v1/cycles/current?mode=quarterly", {
        headers: authed(),
      })
    ).json()).data as { id: string }
  ).id;
  const support = (await post<{ id: string }>("spaces.create", { name: SUPPORT }))
    .id;
  const success = (await post<{ id: string }>("spaces.create", { name: SUCCESS }))
    .id;
  spaceIds.push(support, success);
  goalId = (
    await post<{ id: string }>("goals.create", {
      title: SU1,
      cycleId,
      spaceId: support,
      level: "team",
      ownerKind: "space",
    })
  ).id;
});

test("acceptance: SU1 moves to Customer Success from the list, and stays there", async () => {
  await goTo(page, "/goals");
  const space = main().getByRole("combobox", { name: `Space of ${SU1}` });
  await expect(space).toBeVisible({ timeout: 15_000 });
  await expect(space.locator("option:checked")).toHaveText(SUPPORT);

  await space.selectOption({ label: SUCCESS });
  await expect
    .poll(
      async () =>
        (
          await (
            await api.get(`/api/v1/goals/read?id=${goalId}`, {
              headers: authed(),
            })
          ).json()
        ).data.spaceId,
      { timeout: 15_000 },
    )
    .toBe(spaceIds[1]);

  await page.reload();
  await expect(
    main()
      .getByRole("combobox", { name: `Space of ${SU1}` })
      .locator("option:checked"),
  ).toHaveText(SUCCESS, { timeout: 15_000 });
});

function main() {
  return page.locator("#main-content");
}
