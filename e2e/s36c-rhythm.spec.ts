/**
 * The rhythm and thresholds card (UIUX-PLAN.md §6 S-36, METHOD.md §11,
 * P6-G20).
 *
 * Acceptance criterion:
 *   Given a workspace that changes its check-in grace, when a goal passes the
 *   new grace, then it flips to outdated on the new boundary and no other
 *   threshold moved.
 *
 * The flip itself is proved against a real database in
 * `packages/core/test/check-ins.test.ts`, which can move a clock; a browser
 * cannot. What only a browser proves is the other half of that sentence: that
 * the card writes the grace this workspace asked for, that nothing else in the
 * registry moved with it, that an impossible value is refused in words rather
 * than silently dropped, and that reset puts the card back.
 *
 * The refusal is the reason this spec exists. Before P6-G20 the save caught
 * the refusal and returned, so a value the method cannot accept and a
 * successful save looked exactly alike: the page came back, unchanged, saying
 * nothing.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/** The staleness grace field, which is a plain scalar in the registry. */
const GRACE = "input[name='threshold:cadence.stalenessGraceDays']";
/** One rung of a ladder, which was read-only until P6-G20. */
const LADDER_OWNER = "input[name='composite:cadence.blockerLadderHours:owner']";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the card renders the registry, not a fixed list of fields", async () => {
  await goTo(page, "/admin/rhythm");
  await expect(
    page.getByRole("heading", { name: "Rhythm and thresholds" }),
  ).toBeVisible();

  // A scalar, a composite and the section the canon defines it in.
  await expect(page.locator(GRACE)).toBeVisible();
  await expect(page.locator(LADDER_OWNER)).toBeVisible();
  await expect(page.getByText("METHOD §11").first()).toBeVisible();
});

test("an impossible value is refused in words", async () => {
  await page.locator(GRACE).fill("99999");
  await page.getByRole("button", { name: "Save" }).click();

  const refusal = page.getByTestId("rhythm-save");
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  await expect(refusal).toContainText("cadence.stalenessGraceDays");

  // Refused means nothing was written: the field still holds what was typed
  // and the card does not claim a save.
  await expect(refusal).not.toContainText("Saved.");
});

test("a grace this workspace asked for is written, and nothing else moves", async () => {
  await page.locator(GRACE).fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("rhythm-save")).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(page.locator(GRACE)).toHaveValue("5");
  // The ladder beside it was not touched, so it still shows the canon's value
  // as a placeholder rather than a stored one.
  await expect(page.locator(LADDER_OWNER)).toHaveValue("");
});

test("a ladder can be moved, which it could not before", async () => {
  await page.locator(LADDER_OWNER).fill("12");
  await page
    .locator("input[name='composite:cadence.blockerLadderHours:coordinator']")
    .fill("36");
  await page
    .locator("input[name='composite:cadence.blockerLadderHours:sponsor']")
    .fill("60");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("rhythm-save")).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(page.locator(LADDER_OWNER)).toHaveValue("12");
});

test("a half-written set is refused rather than stored", async () => {
  await page
    .locator("input[name='composite:cadence.blockerLadderHours:sponsor']")
    .fill("");
  await page.getByRole("button", { name: "Save" }).click();

  const refusal = page.getByTestId("rhythm-save");
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  await expect(refusal).toContainText("every part");
});

test("reset puts the whole card back to the canon", async () => {
  await goTo(page, "/admin/rhythm");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page
    .getByRole("button", { name: "Reset to the canon" })
    .first()
    .click();

  await expect(page.getByText("Returned")).toBeVisible({ timeout: 15_000 });

  await goTo(page, "/admin/rhythm");
  // Blank means "no opinion", and the placeholder is the canon's own number.
  await expect(page.locator(GRACE)).toHaveValue("");
  await expect(page.locator(LADDER_OWNER)).toHaveValue("");
});
