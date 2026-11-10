/**
 * A dependency names the key result that delivers it (plan 0.7.0 O5,
 * docs/design/key-result-dependencies.md, Northwind NW-Q1-20).
 *
 * Acceptance:
 *   Given a key result that depends on another team, when its providing key
 *   result is named on the S-10 register and then marked done, then the S-14
 *   goal page and the S-10 register both read the dependency as delivered by
 *   it.
 *
 * **A cycle of its own, years ahead,** so the current quarter other specs read
 * is untouched. The depending objective is a company one, which needs no
 * space, and the providing one sits in the first space the claim made. Both
 * are made through the API with a token, and deleted afterwards.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";
import { choose } from "./pickers.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const DEPENDING_GOAL = `Onboarding runs without us in the room ${STAMP}`;
const DEPENDING = `Cut manual setup calls per new account ${STAMP}`;
const PROVIDING_GOAL = `New accounts bring their data in one step ${STAMP}`;
const PROVIDING = `Bulk import generally available ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let cycleId = "";
let dependingGoalId = "";
let providingGoalId = "";
let providingKeyResultId = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const register = () => page.locator("#dependency-register");
const entry = () =>
  register().locator("li").filter({ hasText: DEPENDING });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    for (const id of [dependingGoalId, providingGoalId]) {
      if (id) {
        await api.post("/api/v1/goals/delete", {
          headers: authed(),
          data: { id },
        });
      }
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with a dependency on another team that names nothing yet", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Dependency delivered e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  // A quarter far enough ahead that no other spec will ever plan in it.
  const year = new Date().getUTCFullYear() + 9;
  cycleId = (
    await post<{ id: string }>("cycles.create", {
      on: `${year}-08-15`,
      mode: "quarterly",
    })
  ).id;

  const listed = await api.get("/api/v1/spaces/list", { headers: authed() });
  expect(listed.status()).toBe(200);
  const spaceId = ((await listed.json()).data as { id: string }[])[0]?.id;
  expect(spaceId).toBeTruthy();

  dependingGoalId = (
    await post<{ id: string }>("goals.create", {
      title: DEPENDING_GOAL,
      cycleId,
      level: "company",
    })
  ).id;
  const dependingKeyResultId = (
    await post<{ id: string }>("goals.addKeyResult", {
      goalId: dependingGoalId,
      title: DEPENDING,
      direction: "reduce",
      indicatorType: "lagging",
      baselineValue: 1.2,
      targetValue: 0.6,
      weight: 1,
    })
  ).id;

  providingGoalId = (
    await post<{ id: string }>("goals.create", {
      title: PROVIDING_GOAL,
      cycleId,
      level: "team",
      ownerKind: "space",
      spaceId,
    })
  ).id;
  providingKeyResultId = (
    await post<{ id: string }>("goals.addKeyResult", {
      goalId: providingGoalId,
      title: PROVIDING,
      kind: "milestone",
      indicatorType: "leading",
      weight: 1,
    })
  ).id;

  await post("goals.addKeyResultDependency", {
    keyResultId: dependingKeyResultId,
    providerSpaceId: spaceId,
    note: "Fewer setup calls depend on bulk import.",
  });
});

test("acceptance: named on S-10, marked done, read as delivered on S-14 and S-10", async () => {
  await goTo(page, `/cycle?cycle=${cycleId}&phase=5`);
  await expect(register()).toBeVisible({ timeout: 15_000 });
  await expect(entry()).toBeVisible();
  // Nothing named yet, so nothing says what delivers it.
  await expect(entry().getByTestId("dependency-delivery")).toHaveCount(0);

  // The depending team names the providing key result from the register.
  const naming = entry()
    .locator("form")
    .filter({ has: page.getByLabel("Delivered by") });
  await choose(naming.getByLabel("Delivered by"), PROVIDING);
  await naming.getByRole("button", { name: "Set" }).click();
  const delivery = entry().getByTestId("dependency-delivery");
  await expect(delivery).toContainText(`What delivers it: ${PROVIDING}`, {
    timeout: 15_000,
  });
  await expect(
    delivery.getByText("Not delivered yet", { exact: true }),
  ).toBeVisible();

  // The providing team ticks its milestone done (NW-Q1-20).
  await post("goals.updateKeyResult", { id: providingKeyResultId, done: true });

  // S-14: the goal page's rail reads it as delivered, in words.
  await goTo(page, `/goals/${dependingGoalId}`);
  const rail = page.getByTestId("dependency-delivery");
  await expect(rail).toContainText(`What delivers it: ${PROVIDING}`, {
    timeout: 15_000,
  });
  await expect(rail.getByText("Delivered", { exact: true })).toBeVisible();

  // S-10 says the same, and delivery settles nothing: the entry is still
  // unsettled until the providing team confirms it.
  await goTo(page, `/cycle?cycle=${cycleId}&phase=5`);
  await expect(register()).toBeVisible({ timeout: 15_000 });
  await expect(
    entry().getByTestId("dependency-delivery").getByText("Delivered", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(entry().getByText("Unsettled", { exact: true })).toBeVisible();
});
