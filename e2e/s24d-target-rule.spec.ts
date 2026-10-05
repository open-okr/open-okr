/**
 * One rule for a target, all cycle (P9-T13-c-b, METHOD.md §2.9 and §7.6).
 *
 * Acceptance A5:
 *   Given a key result from 40 to a target of 100, when its owner eases the
 *   target to 80 without a reason, then it is refused, and with a reason
 *   both 100 and 80 show at the close. Raising it to 110 saves with no
 *   reason.
 *
 * The list's own prompt for the reason is proved in `s13-okr-editor`; this is
 * the refusal every surface shares, and the close that reads the record.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const REASON = "Brightline entered the segment on 10 May";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let spaceId = "";
let goalId = "";
let keyResultId = "";
let sessionId = "";

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
    if (sessionId) {
      await api.post("/api/v1/sessions/close", {
        headers: authed(),
        data: { id: sessionId },
      });
    }
    if (goalId) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goalId },
      });
    }
    if (spaceId) {
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id: spaceId },
      });
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, and a key result from 40 to a target of 100", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Target rule e2e");
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
  const directory = (await (
    await api.get("/api/v1/people/directory", { headers: authed() })
  ).json()).data as { id: string; name: string }[];
  const me = directory.find((member) => member.name === INSTANCE_ACCOUNT.name);
  spaceId = (
    await post<{ id: string }>("spaces.create", { name: `Targets ${STAMP}` })
  ).id;
  goalId = (
    await post<{ id: string }>("goals.create", {
      title: `Win the mid-market deals we are in ${STAMP}`,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
    })
  ).id;
  keyResultId = (
    await post<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: `Win rate from 40% to 100% ${STAMP}`,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 40,
      targetValue: 100,
    })
  ).id;
  sessionId = (
    await post<{ id: string }>("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: `Targets review ${STAMP}`,
      scheduledFor: new Date().toISOString(),
      facilitatorId: me?.id,
    })
  ).id;
});

test("acceptance A5: an easing without a reason is refused, with one it saves, a raise asks nothing, and the close shows the original", async () => {
  const refused = await api.post("/api/v1/goals/changeTarget", {
    headers: authed(),
    data: { id: keyResultId, targetValue: 80 },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toContain(
    "Easing a target needs a written reason",
  );

  await post("goals.changeTarget", {
    id: keyResultId,
    targetValue: 80,
    reason: REASON,
  });

  await post("sessions.open", { id: sessionId });
  await post("sessions.advanceStage", { id: sessionId });
  await goTo(page, `/session/${sessionId}`);
  await expect(page.getByText(/Stage 2 of 11/)).toBeVisible({
    timeout: 15_000,
  });
  // Both at the close: the target as it stands, and the one it began with.
  const row = page
    .getByTestId("original-target")
    .locator("xpath=..");
  await expect(row).toContainText("80");
  await expect(page.getByTestId("original-target")).toHaveText(
    `The target was 100 when the cycle began, and was eased: ${REASON}`,
  );

  // Harder needs no reason.
  await post("goals.changeTarget", { id: keyResultId, targetValue: 110 });
});
