/**
 * The OKR drawer (P9-T08a, docs/design/p9-t00-okr-writing.md §6).
 *
 * Acceptance:
 *   Given a key result edited in the drawer, when it saves, then its list row
 *   shows the new value without a reload.
 *   Given a link to an objective's history, when it is opened, then the drawer
 *   opens on that tab with the value just recorded; Escape in a field puts
 *   the field back, and Escape elsewhere closes the drawer.
 *   Given a link naming an objective in another cycle and no cycle, when it
 *   is opened, then the page opens that cycle with the objective in the drawer.
 *
 * **It leaves what it found.** Both objectives it adds are deleted at the end,
 * whatever happened. The far quarter it may make is the one
 * `s13c-okr-drafts.spec.ts` already makes, found rather than made again.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OBJECTIVE = "Make the first week the reason teams stay";
const KEY_RESULT = "Teams active in week two from 35% to 60%";
const ELSEWHERE = "Plan the far quarter before it starts";
/** The far quarter s13c uses, so neither spec leaves a second one. */
const ON = `${new Date().getUTCFullYear() + 3}-08-15`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");
const drawer = () => page.getByTestId("okr-drawer");

async function goalId(title: string): Promise<string> {
  const listed = await api.get("/api/v1/goals/list", { headers: authed() });
  const found = ((await listed.json()).data.goals as {
    id: string;
    title: string;
  }[]).find((row) => row.title === title);
  return found?.id ?? "";
}

/** The list has said every change reached the server. */
const settled = () =>
  expect(main().getByTestId("okr-list")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 15_000 },
  );

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    for (const title of [OBJECTIVE, ELSEWHERE]) {
      const id = await goalId(title);
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

test("sign in, with a token for putting things back", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("OKR drawer e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
});

test("an objective to open, with a key result, added from the list", async () => {
  // Retry-safe: a second attempt finds the first one's objective.
  if (await goalId(OBJECTIVE)) {
    return;
  }
  await goTo(page, "/goals");
  await main().getByRole("button", { name: "Add objective" }).last().click();
  await page.keyboard.type(OBJECTIVE);
  await page.keyboard.press("Enter");
  const draft = main().getByRole("textbox", { name: "Add key result" });
  await expect(draft).toBeFocused({ timeout: 15_000 });
  await page.keyboard.type(KEY_RESULT);
  await page.keyboard.press("Enter");
  await expect(
    main().locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toBeVisible({ timeout: 15_000 });
  await settled();
});

test("acceptance: a value changed in the drawer moves its list row without a reload", async () => {
  await goTo(page, "/goals");
  const title = main().locator(
    `input[aria-label="Objective title"][value="${OBJECTIVE}"]`,
  );
  await expect(title).toBeVisible({ timeout: 15_000 });
  const row = title.locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  await row.hover();
  await row.getByRole("link", { name: "Open this objective" }).click();
  await expect(drawer()).toBeVisible();
  await expect(drawer().getByRole("heading", { name: OBJECTIVE })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("okr")).toBe(
    await goalId(OBJECTIVE),
  );

  const field = drawer().getByLabel(`Current value for ${KEY_RESULT}`);
  await field.fill("42");
  await field.press("Enter");
  // The row behind the drawer, read without a reload.
  await expect(main().getByLabel(`Current value for ${KEY_RESULT}`)).toHaveValue(
    "42",
    { timeout: 15_000 },
  );
  await settled();

  // And saved: after a reload the address opens the drawer again.
  await page.reload();
  await expect(main().getByLabel(`Current value for ${KEY_RESULT}`)).toHaveValue(
    "42",
    { timeout: 15_000 },
  );
  await expect(drawer()).toBeVisible();
});

test("a link to an objective's history opens the drawer on it, and Escape belongs to the field first", async () => {
  const id = await goalId(OBJECTIVE);
  await goTo(page, `/goals?okr=${id}&tab=history`);
  await expect(drawer()).toBeVisible({ timeout: 15_000 });
  const history = drawer().getByRole("tab", { name: "History" });
  await expect(history).toHaveAttribute("aria-selected", "true");
  await expect(drawer().getByTestId("value-entry").first()).toContainText(
    "42",
    { timeout: 15_000 },
  );

  // Escape in a field puts the field back, and the drawer stays.
  await drawer().getByRole("tab", { name: "Details" }).click();
  const target = drawer().getByLabel(`Target for ${KEY_RESULT}`);
  await target.fill("150");
  await target.press("Escape");
  await expect(target).toHaveValue("100");
  await expect(drawer()).toBeVisible();

  // Anywhere else, Escape closes it and the address forgets it.
  await drawer().getByRole("tab", { name: "Details" }).focus();
  await page.keyboard.press("Escape");
  await expect(drawer()).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("okr")).toBeNull();
});

test("a link to an objective in another cycle opens that cycle", async () => {
  let id = await goalId(ELSEWHERE);
  if (!id) {
    const cycles = await api.get("/api/v1/cycles/list", { headers: authed() });
    let cycleId = (
      (await cycles.json()).data as {
        id: string;
        mode: string;
        startsOn: string;
        endsOn: string;
      }[]
    ).find(
      (cycle) =>
        cycle.mode === "quarterly" && cycle.startsOn <= ON && ON <= cycle.endsOn,
    )?.id;
    if (!cycleId) {
      const created = await api.post("/api/v1/cycles/create", {
        headers: authed(),
        data: { on: ON },
      });
      cycleId = (await created.json()).data.id as string;
    }
    const mine = await api.get(
      `/api/v1/goals/read?id=${await goalId(OBJECTIVE)}`,
      { headers: authed() },
    );
    const championId = (await mine.json()).data.champion.id as string;
    const created = await api.post("/api/v1/goals/create", {
      headers: authed(),
      data: { title: ELSEWHERE, cycleId, level: "team", championId },
    });
    expect(created.status()).toBe(200);
    id = (await created.json()).data.id as string;
  }

  await goTo(page, `/goals?okr=${id}`);
  await expect(drawer().getByRole("heading", { name: ELSEWHERE })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(
    main().locator(`input[aria-label="Objective title"][value="${ELSEWHERE}"]`),
  ).toBeVisible();
});
