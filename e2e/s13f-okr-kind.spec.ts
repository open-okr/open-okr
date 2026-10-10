/**
 * The kind of promise an objective makes (P9-T11b-a, METHOD.md §2.8).
 *
 * Acceptance:
 *   Given an aspirational objective, when its champion marks it committed
 *   with a reason, then the list, the drawer and the diagram show
 *   "Committed" and the activity records the change and its reason.
 *
 * The activity row itself, with both kinds and the reason, is read back in
 * `packages/core/test/goal-kind.test.ts`; what this proves is the path a
 * person takes and that every view of the objective agrees afterwards.
 *
 * **It leaves what it found.** Both objectives it adds are deleted at the
 * end, whatever happened.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const PROMISED = "Answer every enterprise ticket inside one working day";
const STRETCH = "Make the first week the reason teams renew";
const REASON = "The board made it a promise to our three largest customers.";
const FLOOR_KEY_RESULT = "Enterprise tickets closed in a day from 60% to 95%";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");
const drawer = () => page.getByTestId("okr-drawer");
const kindOf = (title: string) =>
  main().getByRole("combobox", { name: `Kind of ${title}` });
const titled = (title: string) =>
  main().locator(`input[aria-label="Objective title"][value="${title}"]`);

async function idOf(title: string): Promise<string> {
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
    for (const title of [PROMISED, STRETCH]) {
      const id = await idOf(title);
      if (id) {
        const deleted = await api.post("/api/v1/goals/delete", {
          headers: authed(),
          data: { id },
        });
        expect(deleted.status()).toBe(200);
      }
    }
  }
  await api?.dispose();
  await context?.close();
});

test.describe("NW-Q1-04 and NW-Q2-10: objectives drafted by kind, and a change of kind", () => {
  test("sign in, with a token for putting things back", async () => {
    await signIn(page);
    await goTo(page, "/account/api-tokens");
    await page.getByLabel("Name").fill("OKR kind e2e");
    await page.getByRole("checkbox", { name: "Write" }).check();
    await page.getByRole("checkbox", { name: "Destructive" }).check();
    await page.getByRole("button", { name: "Create token" }).click();
    const shown = page.getByTestId("minted-token");
    await expect(shown).toBeVisible({ timeout: 10_000 });
    token = ((await shown.textContent()) ?? "").trim();
  });

  test("NW-Q1-04: a new objective is drafted as committed, and one added from the list starts aspirational", async () => {
    await goTo(page, "/goals");
    if (!(await idOf(PROMISED))) {
      await main().getByRole("button", { name: "New objective" }).click();
      // Aspirational unless somebody says otherwise (decision D2).
      const kind = main().getByRole("combobox", { name: "Kind", exact: true });
      await expect(kind).toHaveValue("aspirational");
      await kind.selectOption("committed");
      await main().getByRole("textbox", { name: "New objective" }).fill(PROMISED);
      await main().getByRole("textbox", { name: "New objective" }).press("Enter");
    }
    await expect(kindOf(PROMISED)).toHaveValue("committed", {
      timeout: 15_000,
    });

    if (!(await idOf(STRETCH))) {
      await main().getByRole("button", { name: "Add objective" }).last().click();
      await page.keyboard.type(STRETCH);
      await page.keyboard.press("Enter");
      // The key result draft it opens is left empty, which writes nothing.
      await page.keyboard.press("Escape");
    }
    await expect(kindOf(STRETCH)).toHaveValue("aspirational", {
      timeout: 15_000,
    });
    await settled();
  });

  test("acceptance: marked committed with a reason, the list, the drawer and the diagram all say so", async () => {
    await goTo(page, "/goals");
    await kindOf(STRETCH).selectOption("committed");
    // Nothing is sent until the question beside it is answered or skipped.
    const why = main().getByRole("textbox", {
      name: "Marking it committed. Why?",
    });
    await expect(why).toBeFocused();
    await why.fill(REASON);
    await why.press("Enter");
    await expect(why).toBeHidden();
    await settled();
    await expect(kindOf(STRETCH)).toHaveValue("committed");

    // Saved, not only drawn: a reload reads it from the server.
    await page.reload();
    await expect(kindOf(STRETCH)).toHaveValue("committed", {
      timeout: 15_000,
    });

    // The drawer reads the same cache.
    const row = titled(STRETCH).locator(
      "xpath=ancestor::div[contains(@class, 'grid')][1]",
    );
    await row.hover();
    await row.getByRole("link", { name: "Open this objective" }).click();
    await expect(drawer()).toBeVisible();
    await expect(
      drawer().getByRole("combobox", { name: `Kind of ${STRETCH}` }),
    ).toHaveValue("committed");

    // And the diagram names it in the card's accessible name.
    await goTo(page, "/goals?display=diagram");
    await expect(
      page.getByRole("group", {
        name: new RegExp(`^${STRETCH}, committed `),
      }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("NW-Q1-25: a commitment checked in below the floor is told so before it is published", async () => {
    // P9-T11b-c. The Coach's message to the champion once it is published is
    // proved in packages/core/test/silent-triggers.test.ts.
    const goalId = await idOf(PROMISED);
    const listed = await api.get(`/api/v1/goals/read?id=${goalId}`, {
      headers: authed(),
    });
    const keyResults = (await listed.json()).data.keyResults as unknown[];
    if (keyResults.length === 0) {
      const added = await api.post("/api/v1/goals/addKeyResult", {
        headers: authed(),
        data: {
          goalId,
          title: FLOOR_KEY_RESULT,
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 60,
          targetValue: 95,
        },
      });
      expect(added.status()).toBe(200);
    }
    await goTo(page, `/goals?okr=${goalId}&tab=check-in`);
    const confidence = drawer().getByLabel(
      `Confidence in ${FLOOR_KEY_RESULT}`,
    );
    await expect(confidence).toBeVisible({ timeout: 15_000 });
    await confidence.fill("4");
    await expect(drawer().getByTestId("committed-floor")).toHaveText(
      "A commitment nobody believes in is a risk. Escalate now, or make it aspirational",
    );
    await confidence.fill("8");
    await expect(drawer().getByTestId("committed-floor")).toHaveCount(0);
  });

  test("the kind filter keeps one kind, in the address", async () => {
    await goTo(page, "/goals?kind=aspirational");
    await expect(main().getByTestId("okr-list")).toBeVisible({
      timeout: 15_000,
    });
    await expect(titled(STRETCH)).toHaveCount(0);
    await expect(titled(PROMISED)).toHaveCount(0);

    await goTo(page, "/goals?kind=committed");
    await expect(titled(STRETCH)).toBeVisible({ timeout: 15_000 });
    await expect(titled(PROMISED)).toBeVisible();
  });
});
