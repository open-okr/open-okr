/**
 * A goal that stands alone, and the checks at their levels (P9-T16b-a,
 * METHOD.md §4.3, §5.2).
 *
 * Acceptance:
 *   Given an objective with no parent, when it is read on the diagram, then
 *   the health panel lists it as not counted. When its owner says in the
 *   drawer why it stands alone, then the drawer says it is counted and the
 *   panel stops listing it (NW-Q1-11). Given a team objective hung straight
 *   under a company one, then no level-skip finding is shown, because AL-3 is
 *   off by default (NW-Q1-10).
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const COMPANY = `Customers renew because they grow with us ${STAMP}`;
const FINANCE = `Close the books in five days ${STAMP}`;
const SKIPPER = `Make onboarding something customers finish ${STAMP}`;
const REASON = "Finance operating cadence the board relies on";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
const created: string[] = [];

const authed = () => ({ authorization: `Bearer ${token}` });
const panel = () => page.getByTestId("alignment-panel");
const drawer = () => page.getByTestId("okr-drawer");

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

/** The panel's not-counted list, opened in full when it is long. */
async function notCounted(): Promise<string> {
  const list = panel().getByTestId("alignment-uncounted");
  if ((await list.count()) === 0) {
    return "";
  }
  const showAll = list.getByRole("button", { name: /^Show all \d+ goals/ });
  if ((await showAll.count()) > 0) {
    await showAll.click();
  }
  return list.innerText();
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    for (const id of created.reverse()) {
      await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id },
      });
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with an objective that has no parent", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Standalone e2e");
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
  const listed = await api.get("/api/v1/spaces/list", { headers: authed() });
  expect(listed.status()).toBe(200);
  const spaces = (await listed.json()).data as { id: string }[];
  const spaceId = spaces[0]?.id ?? "";
  expect(spaceId).not.toBe("");

  const company = await post<{ id: string }>("goals.create", {
    title: COMPANY,
    cycleId,
    level: "company",
  });
  created.push(company.id);
  for (const [title, parentGoalId] of [
    [FINANCE, undefined],
    [SKIPPER, company.id],
  ] as const) {
    created.push(
      (
        await post<{ id: string }>("goals.create", {
          title,
          cycleId,
          level: "team",
          ownerKind: "space",
          spaceId,
          ...(parentGoalId ? { parentGoalId } : {}),
        })
      ).id,
    );
  }
});

test("acceptance: the panel lists it, and a reason in the drawer counts it", async () => {
  const finance = created[1] as string;
  await goTo(page, "/goals?display=diagram");
  await expect(panel()).toBeVisible({ timeout: 15_000 });
  expect(await notCounted()).toContain(FINANCE);

  await goTo(page, `/goals?display=diagram&okr=${finance}&tab=alignment`);
  await expect(drawer()).toBeVisible({ timeout: 15_000 });
  await expect(
    drawer().getByText(/Not counted in the alignment score/),
  ).toBeVisible();
  const field = drawer().getByLabel("Why it stands alone");
  await field.fill(REASON);
  await field.press("Enter");
  await expect(
    drawer().getByText("Counted as aligned in the alignment score."),
  ).toBeVisible({ timeout: 15_000 });

  await goTo(page, "/goals?display=diagram");
  await expect(panel()).toBeVisible({ timeout: 15_000 });
  expect(await notCounted()).not.toContain(FINANCE);
});

test("acceptance: a skipped level says nothing, because AL-3 is off by default", async () => {
  await goTo(page, "/goals?display=diagram");
  await expect(panel()).toBeVisible({ timeout: 15_000 });
  // It is named elsewhere in the panel, for its missing key results; what
  // must be absent is the skip.
  await expect(panel().getByText("AL-3", { exact: true })).toHaveCount(0);
  await expect(panel()).not.toContainText(
    `team goal aligned straight to a company goal skips a level`,
  );
});
