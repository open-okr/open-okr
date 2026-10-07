/**
 * Escalating a dependency to the sponsor (P9-T16b-b, METHOD.md §5.4).
 *
 * Acceptance (NW-Q2-07):
 *   Given an unconfirmed dependency, when it is escalated from the register,
 *   then the sponsor's review inbox lists it, and confirming it clears it.
 *
 * The signed-in account is the sponsor here, so one browser can see both
 * ends. The cycle's sponsor is put back as it was afterwards.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const OBJECTIVE = `Expansion comes from accounts that reached value ${STAMP}`;
const KEY_RESULT = `Lift expansion revenue to 22% ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let cycleId = "";
let previousSponsor: string | null = null;
let goalId = "";
let dependencyId = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const register = () => page.locator("#dependency-register");

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
    if (cycleId) {
      await api.post("/api/v1/cycles/update", {
        headers: authed(),
        data: { id: cycleId, sponsorId: previousSponsor },
      });
    }
    if (goalId) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goalId },
      });
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with a dependency nobody has confirmed", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Escalation e2e");
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
  ).data as { id: string; sponsorId: string | null };
  cycleId = cycle.id;
  previousSponsor = cycle.sponsorId;

  const listed = await api.get("/api/v1/spaces/list", { headers: authed() });
  expect(listed.status()).toBe(200);
  const spaceId = ((await listed.json()).data as { id: string }[])[0]?.id;
  expect(spaceId).toBeTruthy();

  goalId = (
    await post<{ id: string }>("goals.create", {
      title: OBJECTIVE,
      cycleId,
      level: "company",
    })
  ).id;
  const keyResultId = (
    await post<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: KEY_RESULT,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 14,
      targetValue: 22,
      unit: "%",
      weight: 1,
    })
  ).id;
  dependencyId = (
    await post<{ id: string }>("goals.addKeyResultDependency", {
      keyResultId,
      providerSpaceId: spaceId,
      note: "In-app expansion prompts",
    })
  ).id;

  // The signed-in account becomes the cycle's sponsor.
  const me = (
    (await (
      await api.get(`/api/v1/goals/read?id=${goalId}`, { headers: authed() })
    ).json()).data as { champion: { id: string } }
  ).champion.id;
  await post("cycles.update", { id: cycleId, sponsorId: me });
});

test("acceptance: escalated from the register, listed for the sponsor, cleared by a confirmation", async () => {
  await goTo(page, `/cycle?cycle=${cycleId}&phase=5`);
  await expect(register()).toBeVisible({ timeout: 15_000 });
  const entry = register()
    .locator("li")
    .filter({ hasText: KEY_RESULT });
  await expect(entry.getByText("Unsettled", { exact: true })).toBeVisible();

  await entry.getByRole("button", { name: /^Escalate to / }).click();
  await expect(entry.getByText("Escalated", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(entry.getByText(/^Nobody has agreed yet\. Escalated to /)).toBeVisible();

  await goTo(page, "/review");
  const row = page.getByText(`Decide the dependency of "${KEY_RESULT}"`, {
    exact: false,
  });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Escalated to you as sponsor/).first()).toBeVisible();

  await post("goals.confirmDependency", { id: dependencyId });
  await goTo(page, "/review");
  await expect(
    page.getByText(`Decide the dependency of "${KEY_RESULT}"`, {
      exact: false,
    }),
  ).toHaveCount(0);
});
