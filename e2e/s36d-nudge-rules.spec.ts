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

/**
 * The per-rule escalation ladder (§11, P6-G21b).
 *
 * `nudge_rules.escalation_ladder` has been stored since P4-T04b and read by
 * nothing, and no screen ever offered it. This is the round trip: set one,
 * see it come back, and put it away again so the instance is as it was for
 * whatever spec runs next.
 */
test("a ladder is set, refused when out of order, and returned to the canon", async () => {
  const OWNER = "blocker.escalated";
  await goTo(page, "/admin/nudges");

  const editor = page.getByTestId(`ladder-${OWNER}`);
  await expect(editor).toBeVisible({ timeout: 15_000 });
  // It says what one ladder reaches, because the change is not scoped to the
  // rule it is set on.
  await expect(editor).toContainText("blocker.warning");

  // Out of order first: the top rung fires before the ones below it, which is
  // not a ladder. §11's schema types each rung and says nothing about order,
  // so this refusal is the product's own.
  await editor.getByLabel(`owner for ${OWNER}`).fill("30");
  await editor.getByLabel(`coordinator for ${OWNER}`).fill("24");
  await editor.getByLabel(`sponsor for ${OWNER}`).fill("48");
  await editor.getByTestId(`save-ladder-${OWNER}`).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "must come after",
    { timeout: 15_000 },
  );

  // Then one §11 accepts.
  await editor.getByLabel(`owner for ${OWNER}`).fill("4");
  await editor.getByLabel(`coordinator for ${OWNER}`).fill("8");
  await editor.getByLabel(`sponsor for ${OWNER}`).fill("12");
  await editor.getByTestId(`save-ladder-${OWNER}`).click();

  await goTo(page, "/admin/nudges");
  await expect(page.getByTestId(`ladder-${OWNER}`).getByLabel(
    `owner for ${OWNER}`,
  )).toHaveValue("4", { timeout: 15_000 });

  // And away again. A row kept only to hold a copy of §11's numbers would
  // survive a change to §11, so emptying every rung removes it.
  const back = page.getByTestId(`ladder-${OWNER}`);
  for (const rung of ["owner", "coordinator", "sponsor"]) {
    await back.getByLabel(`${rung} for ${OWNER}`).fill("");
  }
  await back.getByTestId(`save-ladder-${OWNER}`).click();

  await goTo(page, "/admin/nudges");
  await expect(page.getByTestId(`ladder-${OWNER}`).getByLabel(
    `owner for ${OWNER}`,
  )).toHaveValue("", { timeout: 15_000 });
});
