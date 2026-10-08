/**
 * Adding objectives and key results from the OKR list (P9-T07b-a,
 * docs/design/okr-writing.md §4.3 and §3).
 *
 * Acceptance:
 *   Given the list, when a member adds an objective with two key results
 *   using only the keyboard, then both are saved and visible after a reload,
 *   and nothing was written before the first Enter (U1).
 *   Given a draft key result row with nothing typed, when Escape is pressed,
 *   then the row disappears and no record exists (U2).
 *   Given a workspace that creates objectives only in its planning window, a
 *   cycle outside it, when a member presses "+ New objective", then a panel
 *   names the reason and links to what resolves it (U8).
 *
 * **It leaves what it found.** The objective it adds is deleted at the end,
 * and the practice it restricts is put back, whatever happened, because every
 * later spec writes on the recommended profile.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OBJECTIVE = "Turn first logins into weekly habits";
const FIRST = "Weekly active teams from 40 to 70";
const SECOND = "Teams inviting a second member from 20% to 45%";
/** A quarter three years out, whose planning window has not opened. */
const ON = `${new Date().getUTCFullYear() + 3}-08-15`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const main = () => page.locator("#main-content");

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    await api.post("/api/v1/practice/update", {
      headers: authed(),
      data: { overrides: { "writing.when": null } },
    });
    const listed = await api.get("/api/v1/goals/list", { headers: authed() });
    const ours = ((await listed.json()).data?.goals ?? []) as {
      id: string;
      title: string;
    }[];
    for (const goal of ours.filter((row) => row.title === OBJECTIVE)) {
      const deleted = await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goal.id },
      });
      expect(deleted.status()).toBe(200);
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with a token for putting things back", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("OKR drafts e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  // Deleting is destructive, which Write alone is refused, so without this
  // the clean-up below was refused and left its objectives behind.
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
});

test("U2: a draft key result left empty and escaped leaves nothing behind", async () => {
  await goTo(page, "/goals");
  const before = await main().getByLabel("Key result title").count();
  const add = main().getByRole("button", { name: "Add key result" }).first();
  await add.focus();
  await page.keyboard.press("Enter");
  const draft = main().getByRole("textbox", { name: "Add key result" });
  await expect(draft).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(draft).toHaveCount(0);

  await page.reload();
  await expect(main().getByLabel("Key result title")).toHaveCount(before, {
    timeout: 15_000,
  });
});

test("U1: an objective and two key results, with the keyboard alone", async () => {
  await goTo(page, "/goals");
  const add = main().getByRole("button", { name: "Add objective" }).last();
  await add.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type(OBJECTIVE);

  // Nothing is written before the first Enter: the draft lives in the page.
  const listed = await api.get("/api/v1/goals/list", { headers: authed() });
  expect(
    ((await listed.json()).data.goals as { title: string }[]).some(
      (row) => row.title === OBJECTIVE,
    ),
  ).toBe(false);

  await page.keyboard.press("Enter");
  // The objective opens with one key result draft under it, caret in it.
  const first = main().getByRole("textbox", { name: "Add key result" });
  await expect(first).toBeFocused({ timeout: 15_000 });
  await page.keyboard.type(FIRST);
  await page.keyboard.press("Enter");
  await expect(
    main().locator(`input[aria-label="Key result title"][value="${FIRST}"]`),
  ).toBeVisible({ timeout: 15_000 });

  // The second from the add row under it, reached by focus and Enter.
  const objectiveRow = main()
    .locator(`input[aria-label="Objective title"][value="${OBJECTIVE}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]/..");
  const again = objectiveRow.getByRole("button", { name: "Add key result" });
  await again.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type(SECOND);
  await page.keyboard.press("Enter");
  await expect(
    main().locator(`input[aria-label="Key result title"][value="${SECOND}"]`),
  ).toBeVisible({ timeout: 15_000 });

  await page.reload();
  for (const title of [FIRST, SECOND]) {
    await expect(
      main().locator(`input[aria-label="Key result title"][value="${title}"]`),
    ).toBeVisible({ timeout: 15_000 });
  }
});

/**
 * P9-T07b-b's acceptance: the third key result moved to the top with Alt and
 * the up arrow twice, saved, and in that order after a reload. The grip keeps
 * the keyboard after each move, so the second press needs no hunting.
 */
test("a key result moved to the top with Alt and the up arrow stays there", async () => {
  const THIRD = "Teams finishing setup in one sitting from 30% to 60%";
  await goTo(page, "/goals");
  const objectiveRow = main()
    .locator(`input[aria-label="Objective title"][value="${OBJECTIVE}"]`)
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]/..");
  if (
    (await main()
      .locator(`input[aria-label="Key result title"][value="${THIRD}"]`)
      .count()) === 0
  ) {
    await objectiveRow.getByRole("button", { name: "Add key result" }).click();
    await page.keyboard.type(THIRD);
    await page.keyboard.press("Enter");
  }
  const order = async () =>
    (
      await objectiveRow
        .locator('input[aria-label="Key result title"]')
        .evaluateAll((fields) =>
          fields.map((field) => (field as HTMLInputElement).value),
        )
    ).filter((title) => [FIRST, SECOND, THIRD].includes(title));
  await expect.poll(order, { timeout: 15_000 }).toEqual([FIRST, SECOND, THIRD]);

  await main().getByRole("button", { name: `Move ${THIRD}: drag, or press Alt with an arrow key` }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual([FIRST, THIRD, SECOND]);
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual([THIRD, FIRST, SECOND]);

  await expect(main().getByTestId("okr-list")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 15_000 },
  );
  await page.reload();
  await expect.poll(order, { timeout: 15_000 }).toEqual([THIRD, FIRST, SECOND]);
});

test("an objective deleted from the list comes back with Undo", async () => {
  await goTo(page, "/goals");
  const title = main().locator(
    `input[aria-label="Objective title"][value="${OBJECTIVE}"]`,
  );
  await expect(title).toBeVisible({ timeout: 15_000 });
  const row = title.locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  await row.hover();
  await row.getByRole("button", { name: "Delete this objective" }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(title).toHaveCount(0);

  const toast = page.getByTestId("toast").filter({ hasText: "Objective deleted" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(title).toBeVisible({ timeout: 15_000 });
  await expect(main().getByTestId("okr-list")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 15_000 },
  );
  await page.reload();
  await expect(title).toBeVisible({ timeout: 15_000 });
});

test("U8: where writing is held back, + New objective names the reason and where it is resolved", async () => {
  const updated = await api.post("/api/v1/practice/update", {
    headers: authed(),
    data: { overrides: { "writing.when": "planningWindow" } },
  });
  expect(updated.status()).toBe(200);

  // Retry-safe: the quarter is made once.
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

  await goTo(page, `/goals?cycle=${cycleId}`);
  await main().getByRole("button", { name: "New objective" }).click();
  const panel = main().getByTestId("restricted-writing");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel).toContainText("in the planning window");
  await expect(
    panel.getByRole("link", { name: "Change who may write, and when" }),
  ).toBeVisible();
  // And the add row at the foot of the list says the same, rather than
  // taking a title the server would refuse.
  await main().getByRole("button", { name: "Add objective" }).last().click();
  await expect(main().getByTestId("restricted-writing")).toHaveCount(2);
});

test("the topbar's + New opens the new objective where the reader can write", async () => {
  await api.post("/api/v1/practice/update", {
    headers: authed(),
    data: { overrides: { "writing.when": null } },
  });
  await goTo(page, "/");
  await page.getByRole("link", { name: "New objective" }).first().click();
  await expect(page).toHaveURL(/\/goals\?new=objective/);
  await expect(
    main().getByRole("textbox", { name: "New objective" }),
  ).toBeFocused({ timeout: 15_000 });
});
