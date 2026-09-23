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
 *
 * **Every assertion here is scoped to one card since P8-G11.** The screen used
 * to be one form with a single Save at the bottom of 8,001 pixels; it is now
 * eight forms, one per card, each saving its own thresholds. So "the Save
 * button" is no longer a thing that exists on this page, and a page-level
 * `getByRole("button", { name: "Save" })` matches eight elements and fails
 * Playwright's strict mode rather than picking one.
 *
 * **The outcome is a toast since P8-G11a, and that is the point of it.** The
 * sentence used to render at the top of the card, which on a card 1,700px tall
 * with a sticky Save meant pressing the button at the bottom of twenty
 * parameters and seeing nothing at all. A refusal now also names its parameter
 * under that parameter's own field, and this file asserts both, because the
 * toast alone would not prove the reader is taken to the box that was refused.
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

/**
 * The card both fields live in. Every save, refusal and reset below belongs to
 * this one form, and scoping to it is what keeps the assertions unambiguous
 * now that seven sibling cards carry the same controls.
 */
const cadenceCard = (page: Page) => page.getByTestId("rhythm-card-cadence");
const save = (page: Page) =>
  cadenceCard(page).getByRole("button", { name: "Save" });

/**
 * The toast, which is where a save says what happened.
 *
 * **Named by tone rather than just by test id.** A confirmation runs for six
 * seconds, so a test that saves and a test that is refused a moment later can
 * have both on screen at once, and an unscoped `getByTestId("toast")` then
 * matches two and fails strict mode. Saying which one is expected is also a
 * sharper assertion: it is the difference between "something was said" and
 * "it was refused".
 */
const outcome = (page: Page, tone: "ok" | "bad") =>
  page.locator(`[data-testid="toast"][data-tone="${tone}"]`);

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

  // A scalar and a composite. **The METHOD §x chip used to be asserted here
  // and is gone since P8-G11b**: 53 of them on this one screen, which Agung
  // asked to be rid of. The sentence under each label stays.
  await expect(page.locator(GRACE)).toBeVisible();
  await expect(page.locator(LADDER_OWNER)).toBeVisible();
  await expect(page.getByText("METHOD §")).toHaveCount(0);
});

test("an impossible value is refused in words", async () => {
  await page.locator(GRACE).fill("99999");
  await save(page).click();

  const refusal = outcome(page, "bad");
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  await expect(refusal).toContainText("cadence.stalenessGraceDays");

  // **Refused means nothing was written, and nothing was taken away either.**
  // React resets a form with an `action` once that action resolves, so until
  // P8-G11a the typed value was gone the moment it was refused: you were told
  // 500 was too big while the box had already gone back to 200. This line is
  // the one the comment here used to claim and never checked.
  await expect(page.locator(GRACE)).toHaveValue("99999");
  await expect(refusal).not.toContainText("Saved.");

  // **The half a toast cannot carry.** The method named a parameter, so the
  // sentence is under that parameter's own field and the field says it is the
  // invalid one. Without this you are told something was refused and left to
  // find which of twenty boxes it was.
  await expect(page.locator(GRACE)).toHaveAttribute("aria-invalid", "true");
  // The method's own words, minus the key that the toast already carries.
  // Asserted as non-empty rather than by wording, because the sentence comes
  // from the §11 schema's bound, and changing that bound is a method decision
  // this spec has no business pinning.
  const fieldError = cadenceCard(page).getByTestId("rhythm-field-error");
  await expect(fieldError).toBeVisible();
  await expect(fieldError).not.toBeEmpty();
});

test("a grace this workspace asked for is written, and nothing else moves", async () => {
  await page.locator(GRACE).fill("5");
  await save(page).click();
  await expect(outcome(page, "ok")).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(page.locator(GRACE)).toHaveValue("5");
  // The ladder beside it was not touched, so it still shows the method's own
  // value as a placeholder rather than a stored one.
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
  await save(page).click();
  await expect(outcome(page, "ok")).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(page.locator(LADDER_OWNER)).toHaveValue("12");
});

test("a half-written set is refused rather than stored", async () => {
  await page
    .locator("input[name='composite:cadence.blockerLadderHours:sponsor']")
    .fill("");
  await save(page).click();

  const refusal = outcome(page, "bad");
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  await expect(refusal).toContainText("every part");
});

test("reset puts the whole card back to its defaults", async () => {
  await goTo(page, "/admin/rhythm");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await cadenceCard(page)
    .getByRole("button", { name: "Reset to defaults" })
    .click();

  await expect(outcome(page, "ok")).toContainText("Returned", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  // Blank means "no opinion", and the placeholder is the method's number.
  await expect(page.locator(GRACE)).toHaveValue("");
  await expect(page.locator(LADDER_OWNER)).toHaveValue("");
});

test("a word list takes this workspace's own terms, and keeps the method's", async () => {
  // **Adding is all the method allows, and that is the finding rather than a
  // limitation of this screen.** §11 words the parameter as "a workspace may
  // add terms; the canon terms remain", and `resolveThresholds` merges rather
  // than replaces, because replacing would let a workspace switch a quality
  // rule off by storing an empty list.
  await goTo(page, "/admin/rhythm");
  const field = page.locator(
    "input[name='words:quality.wordLists:outputVerbs']",
  );
  await expect(field).toBeVisible();

  const before = await page
    .getByText(/^launch, build, ship/)
    .first()
    .textContent();
  expect(before).toContain("launch");

  await field.fill("luncurkan, terbitkan");
  await page
    .getByTestId("rhythm-card-quality")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(outcome(page, "ok")).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(field).toHaveValue("luncurkan, terbitkan");
  // The method's own terms are still there, and still not editable.
  await expect(page.getByText(/^launch, build, ship/).first()).toBeVisible();

  // Put it back, so no later spec inherits this workspace's vocabulary.
  await field.fill("");
  await page
    .getByTestId("rhythm-card-quality")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(outcome(page, "ok")).toContainText("Saved.", {
    timeout: 15_000,
  });
});
