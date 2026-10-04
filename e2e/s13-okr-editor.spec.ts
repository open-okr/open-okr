/**
 * The editable OKR set on S-13 — P8-G12.
 *
 * Acceptance criteria:
 *   Given a member with edit rights, when they press Add objective on the OKR
 *   screen, then the objective is created in the cycle on screen and appears
 *   without leaving it.
 *
 *   Given an objective on that screen, when they press Add key result and
 *   name it, then the key result is created under that objective.
 *
 *   Given a key result with a value, when they type a new value in the table,
 *   then the value is recorded and the progress beside it moves.
 *
 *   Given the Diagram tab, when it is opened, then the same cycle is drawn
 *   with its objectives and their key results.
 *
 *   Given the list open in two tabs, when a title is changed in one, then
 *   the other shows it without a reload (P9-T06c).
 *
 * **A browser proves what the action tests cannot**: that a value typed into
 * a cell reaches `goals.recordValue` and comes back as a different number on
 * the row, and that the add controls exist on the screen somebody is reading
 * rather than three navigations away, which is the whole complaint this work
 * answers.
 *
 * **The file name carries the run order:** specs run alphabetically against
 * one instance and `registration-to-dashboard.spec.ts` claims it, so anything
 * that signs in sorts after `registration-`.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const OBJECTIVE = "Make onboarding something customers finish by themselves";
const KEY_RESULT = "Accounts reaching first value within seven days";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and open the OKR screen", async () => {
  await signIn(page);
  await goTo(page, "/goals");
  await expect(page.getByRole("group", { name: "Display" })).toBeVisible({
    timeout: 15_000,
  });
});

test("an objective is added without leaving the screen", async () => {
  await page.getByRole("button", { name: "Add objective" }).click();
  const field = page.getByRole("textbox", { name: "Add objective" });
  await field.fill(OBJECTIVE);
  await field.press("Enter");

  // The row is an input carrying the title, so the assertion is on its value.
  await expect(
    page.locator(`input[aria-label="Objective title"][value="${OBJECTIVE}"]`),
  ).toBeVisible({ timeout: 15_000 });
});

test("a key result is added under that objective", async () => {
  const addRows = page.getByRole("button", { name: "Add key result" });
  await addRows.last().click();
  const field = page.getByRole("textbox", { name: "Add key result" });
  await field.fill(KEY_RESULT);
  await field.press("Enter");

  await expect(
    page.locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * One cache for the list, and every tab on it (P9-T06c). The title is
 * changed in one tab and the other shows it without being reloaded, which is
 * the cache telling the other tab over the browser's own channel; another
 * member's change arrives on the workspace's live stream instead.
 */
test("a title changed in one tab shows in another without a reload", async () => {
  const other = await context.newPage();
  await goTo(other, "/goals");
  const titled = (where: typeof page, value: string) =>
    where.locator(`input[aria-label="Objective title"][value="${value}"]`);
  await expect(titled(other, OBJECTIVE)).toBeVisible({ timeout: 15_000 });

  const renamed = `${OBJECTIVE}, from the first tab`;
  // Enter on the keyboard rather than on the locator: the locator finds the
  // field by its value, which is no longer the old title once it is filled.
  await titled(page, OBJECTIVE).fill(renamed);
  await page.keyboard.press("Enter");
  // At once in this tab, and in the other without a navigation.
  await expect(titled(page, renamed)).toBeVisible({ timeout: 5_000 });
  await expect(titled(other, renamed)).toBeVisible({ timeout: 15_000 });

  // Back, so the rest of this file and every later spec meet the title they
  // expect.
  await titled(page, renamed).fill(OBJECTIVE);
  await page.keyboard.press("Enter");
  await expect(titled(other, OBJECTIVE)).toBeVisible({ timeout: 15_000 });
  await other.close();
});

test("a value typed into the table is recorded and moves the progress", async () => {
  const value = page.getByRole("spinbutton", {
    name: `Current value for ${KEY_RESULT}`,
  });
  await expect(value).toHaveValue("0");
  await value.fill("40");
  await value.press("Enter");

  // 40 of a 100 target, recorded through the same action a check-in uses.
  await expect(value).toHaveValue("40", { timeout: 15_000 });
  await expect(page.getByText("40%").first()).toBeVisible();
});

test("the diagram draws the same cycle", async () => {
  await page.getByRole("link", { name: "Diagram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Collapse all" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: OBJECTIVE })).toBeVisible();
});

test("a member can take the key result back off the set", async () => {
  await goTo(page, "/goals");
  await page
    .getByRole("button", { name: "Delete this key result" })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(
    page.locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toHaveCount(0, { timeout: 15_000 });
});

/**
 * A key result removed on its own comes back from Deleted items (P9-T06b).
 * Until then only a deleted objective could, and a key result taken off a
 * set was gone for good, whatever the delete control's sentence promised.
 */
test("and Deleted items lists it with who removed it, and brings it back", async () => {
  await goTo(page, "/admin/deleted");
  const row = page
    .getByTestId("deleted-item")
    .filter({ hasText: `${KEY_RESULT} (${OBJECTIVE})` });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Key result");
  await expect(row).toContainText("Deleted by");

  await row
    .getByRole("button", { name: `Restore "${KEY_RESULT} (${OBJECTIVE})"` })
    .click();
  await expect(
    page.getByTestId("toast").filter({ hasText: "Key result restored." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveCount(0, { timeout: 15_000 });

  await goTo(page, "/goals");
  await expect(
    page.locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toBeVisible({ timeout: 15_000 });

  // And off again, so every later spec meets the set it met before.
  await page
    .getByRole("button", { name: "Delete this key result" })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toHaveCount(0, { timeout: 15_000 });
});
