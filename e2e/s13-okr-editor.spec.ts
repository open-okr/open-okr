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
