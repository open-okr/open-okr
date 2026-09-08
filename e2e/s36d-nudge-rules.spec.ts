/**
 * The nudge rule cards (UIUX-PLAN.md §6 S-36, METHOD.md §6.4, P6-G21,
 * GAP-AUDIT G-04).
 *
 * Acceptance criterion:
 *   Given an administrator who disables the noisiest rule, when its trigger
 *   next fires, then no nudge is sent, a suppressed row records why, and every
 *   other rule is unaffected.
 *
 * The suppression itself is proved against a real database in
 * `packages/core`: `suppressionFor` has returned "disabled" for a rule that is
 * off since P4-T04b, and the run writes the row. What only a browser proves is
 * the half that was missing, which is that an administrator can reach the
 * switch at all. Every column on `nudge_rules` existed and nothing could set
 * one.
 *
 * **Everything this spec changes, it changes back.** The instance is shared,
 * and a rule left off or a workspace left quiet would change what later specs
 * see.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/** One rule from §6.4, named here only to click it. */
const RULE = "checkin.due";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("every rule in the catalogue is listed, with its volume", async () => {
  await goTo(page, "/admin/nudges");

  await expect(page.getByRole("heading", { name: /^Rules \(/ })).toBeVisible();
  await expect(page.getByTestId(`toggle-${RULE}`)).toBeVisible();
  // The volume is the argument for turning a rule down, so it is on the row.
  await expect(page.getByTestId(`volume-${RULE}`)).toContainText("sent");
});

test("a rule can be turned off, and says what that means", async () => {
  const toggle = page.getByTestId(`toggle-${RULE}`);
  await expect(toggle).toHaveText("Turn off");
  await toggle.click();

  await expect(page.getByTestId(`toggle-${RULE}`)).toHaveText("Turn on", {
    timeout: 15_000,
  });
  // Held, not vanished: the run still writes a row with its reason, which is
  // what keeps the volume figures honest.
  await expect(
    page.getByText("The run still records each one with its reason"),
  ).toBeVisible();

  await goTo(page, "/admin/nudges");
  await expect(page.getByTestId(`toggle-${RULE}`)).toHaveText("Turn on");
});

test("and every other rule is unaffected", async () => {
  // The acceptance sentence's own last clause. A second rule, untouched.
  await expect(page.getByTestId("toggle-checkin.overdue")).toHaveText("Turn off");
});

test("workspace quiet mode can be turned on and off", async () => {
  const quiet = page.getByTestId("quiet-mode");
  await expect(quiet).toHaveText("Turn quiet mode on");
  await quiet.click();
  await expect(page.getByTestId("quiet-mode")).toHaveText("Quiet mode is on", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/nudges");
  await expect(page.getByTestId("quiet-mode")).toHaveText("Quiet mode is on");
  await page.getByTestId("quiet-mode").click();
  await expect(page.getByTestId("quiet-mode")).toHaveText(
    "Turn quiet mode on",
    { timeout: 15_000 },
  );
});

test("the rule goes back to the canon, leaving the instance as it was", async () => {
  await goTo(page, "/admin/nudges");
  await page.getByTestId(`toggle-${RULE}`).click();
  await expect(page.getByTestId(`toggle-${RULE}`)).toHaveText("Turn off", {
    timeout: 15_000,
  });
});
