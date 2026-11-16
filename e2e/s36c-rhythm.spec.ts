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
 * **The page is one form with one sticky save bar.** Until the settings
 * layout standard it was eight forms, each with its own Save and its own
 * toast. "Save changes" in the bar sends every card at once and is refused as
 * a whole, so a refusal means nothing was written on any card.
 *
 * **The outcome is in the bar, and a refusal also names its parameter under
 * that parameter's own field.** This file asserts both, because the bar alone
 * would not prove the reader is taken to the box that was refused.
 *
 * "Reset to defaults" writes nothing by itself: it blanks the card's fields,
 * the bar lists the card as not saved yet, and Save changes writes the nulls.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";
import { setTokens } from "./tokens.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

/**
 * The staleness grace field, which is a plain scalar in the registry. Found
 * by its box's name: a number field posts through a hidden input of its own,
 * so the box a person types in carries no `name`.
 */
const grace = () =>
  page.getByRole("textbox", { name: "Staleness grace", exact: true });
/**
 * One rung of a ladder, which was read-only until P6-G20. The check-in
 * ladder's, since the blocker ladder became one rung at P9-T19a-a.
 */
const LADDER_OWNER =
  "input[name='composite:cadence.checkInLadderDays:championRepeat']";

/**
 * The card both fields live in. Reset belongs to a card, and scoping to it is
 * what keeps that button unambiguous now that six sibling cards carry one.
 */
const cadenceCard = (page: Page) => page.getByTestId("rhythm-card-cadence");
const bar = (page: Page) => page.getByTestId("rhythm-save-bar");
const save = (page: Page) =>
  bar(page).getByRole("button", { name: "Save changes" });

/**
 * What the bar says. A save, a refusal and "not saved yet" all land in it, so
 * "it was refused" is `alert` and "it was saved" is the confirmation text.
 */
const refusalIn = (page: Page) => bar(page).getByRole("alert");

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
  await expect(grace()).toBeVisible();
  await expect(page.locator(LADDER_OWNER)).toBeVisible();
  await expect(page.getByText("METHOD §")).toHaveCount(0);
});

test("a threshold says what its reason cites, and links to where the method sets it out", async () => {
  await goTo(page, "/admin/rhythm");
  const hint = page.getByTestId("method-hint-popup");

  // The card says "(principle 8)"; the hint says what principle 8 is, and
  // puts back the pointer to the clause the section chip used to be.
  await page
    .getByRole("button", { name: "About Staleness grace", exact: true })
    .hover();
  await expect(hint).toContainText("Principle 8: Neglect must be visible.", {
    timeout: 15_000,
  });
  await expect(hint).toContainText("Set out in the method under “Health”.");
  await expect(hint.getByRole("link")).toHaveAttribute(
    "href",
    /\/blob\/v[^/]+\/docs\/specification\/METHOD\.md#35-health$/,
  );
  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();

  // A dropdown in the check-in card has no reason under it, so its hint
  // carries the reason as well.
  await page
    .getByTestId("rhythm-card-check-in")
    .getByRole("button", { name: "About Check-in frequency", exact: true })
    .click();
  await expect(hint).toContainText("a week is short enough");
  await expect(hint).toContainText("Principle 5: The rhythm is the product.");
  await page.keyboard.press("Escape");
});

test("an impossible value is refused in words", async () => {
  await grace().fill("99999");
  await save(page).click();

  const refusal = refusalIn(page);
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  await expect(refusal).toContainText("cadence.stalenessGraceDays");

  // **Refused means nothing was written, and nothing was taken away either.**
  // React resets a form with an `action` once that action resolves, so until
  // P8-G11a the typed value was gone the moment it was refused: you were told
  // 500 was too big while the box had already gone back to 200. This line is
  // the one the comment here used to claim and never checked.
  // Shown as the reader's locale writes it, grouped.
  await expect(grace()).toHaveValue(/^99,?999$/);
  await expect(bar(page)).not.toContainText("Saved.");

  // **The half a toast cannot carry.** The method named a parameter, so the
  // sentence is under that parameter's own field and the field says it is the
  // invalid one. Without this you are told something was refused and left to
  // find which of twenty boxes it was.
  await expect(grace()).toHaveAttribute("aria-invalid", "true");
  // The method's own words, minus the key that the toast already carries.
  // Asserted as non-empty rather than by wording, because the sentence comes
  // from the §11 schema's bound, and changing that bound is a method decision
  // this spec has no business pinning.
  const fieldError = cadenceCard(page).getByTestId("rhythm-field-error");
  await expect(fieldError).toBeVisible();
  await expect(fieldError).not.toBeEmpty();
});

test("a grace this workspace asked for is written, and nothing else moves", async () => {
  await grace().fill("5");
  await save(page).click();
  await expect(bar(page)).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(grace()).toHaveValue("5");
  // The ladder beside it was not touched, so it still shows the method's own
  // value as a placeholder rather than a stored one.
  await expect(page.locator(LADDER_OWNER)).toHaveValue("");
});

test("a ladder can be moved, which it could not before", async () => {
  await page.locator(LADDER_OWNER).fill("2");
  await page
    .locator("input[name='composite:cadence.checkInLadderDays:coordinator']")
    .fill("9");
  await page
    .locator("input[name='composite:cadence.checkInLadderDays:sponsor']")
    .fill("20");
  await save(page).click();
  await expect(bar(page)).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(page.locator(LADDER_OWNER)).toHaveValue("2");
});

test("a half-written set is refused rather than stored", async () => {
  await page
    .locator("input[name='composite:cadence.checkInLadderDays:sponsor']")
    .fill("");
  await save(page).click();

  const refusal = refusalIn(page);
  await expect(refusal).toBeVisible({ timeout: 15_000 });
  await expect(refusal).toContainText("every part");
});

test("reset puts the whole card back to its defaults", async () => {
  await goTo(page, "/admin/rhythm");
  await cadenceCard(page)
    .getByRole("button", { name: "Reset to defaults" })
    .click();

  // Nothing is written yet: the reset is in the bar as an unsaved change, and
  // the fields are blank with the method's number as their placeholder.
  await expect(bar(page)).toContainText("Not saved yet");
  await expect(grace()).toHaveValue("");
  await save(page).click();
  await expect(bar(page)).toContainText("Saved.", { timeout: 15_000 });

  await goTo(page, "/admin/rhythm");
  // Blank means "no opinion", and the placeholder is the method's number.
  await expect(grace()).toHaveValue("");
  await expect(page.locator(LADDER_OWNER)).toHaveValue("");
});

test("a word list takes this workspace's own terms, and keeps the method's", async () => {
  // **Adding is all the method allows, and that is the finding rather than a
  // limitation of this screen.** §11 words the parameter as "a workspace may
  // add terms; the canon terms remain", and `resolveThresholds` merges rather
  // than replaces, because replacing would let a workspace switch a quality
  // rule off by storing an empty list.
  await goTo(page, "/admin/rhythm");
  // The list's own box, and what the form posts for it (guided-inputs §4.11).
  const field = page.getByLabel("Your own output verbs terms", { exact: true });
  const posted = page.locator(
    "input[name='words:quality.wordLists:outputVerbs']",
  );
  await expect(field).toBeVisible();

  const before = await page
    .getByText(/^launch, build, ship/)
    .first()
    .textContent();
  expect(before).toContain("launch");

  await setTokens(field, ["luncurkan", "terbitkan"]);
  await save(page).click();
  await expect(bar(page)).toContainText("Saved.", {
    timeout: 15_000,
  });

  await goTo(page, "/admin/rhythm");
  await expect(posted).toHaveValue("luncurkan, terbitkan");
  // The method's own terms are still there, and still not editable.
  await expect(page.getByText(/^launch, build, ship/).first()).toBeVisible();

  // Put it back, so no later spec inherits this workspace's vocabulary.
  await setTokens(field, []);
  await save(page).click();
  await expect(bar(page)).toContainText("Saved.", {
    timeout: 15_000,
  });
});

/**
 * A renamed term reaches the screens (completeness review M-14).
 *
 * The terminology card saved a rename and nothing on screen said it: a
 * workspace that calls a space a team still read Spaces in its sidebar and on
 * its Spaces page. The rename and the heading are two different screens, so
 * only a browser proves the one reaches the other.
 *
 * **Put back before the test ends**, whatever it asserted. The suite runs on
 * one workspace, and s01-mobile-navigation and s42-route-coverage both look
 * for "Spaces" after this file.
 */
test("a renamed term is what every screen calls it, and the canon comes back", async () => {
  const terminology = page.getByTestId("rhythm-card-terminology");
  const rename = async (singular: string, plural: string) => {
    await goTo(page, "/admin/rhythm");
    await terminology.locator("input[name='label:space:singular']").fill(singular);
    await terminology.locator("input[name='label:space:plural']").fill(plural);
    await save(page).click();
    await expect(bar(page)).toContainText("Saved.", {
      timeout: 15_000,
    });
  };

  await rename("Team", "Teams");
  try {
    await goTo(page, "/spaces");
    await expect(
      page.getByRole("heading", { level: 1, name: "Teams" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    // The sidebar entry, not only the page.
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Teams", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "New team" })).toBeVisible();
  } finally {
    // The canon's own words, which the action stores as no rename at all.
    await rename("Space", "Spaces");
  }

  await goTo(page, "/spaces");
  await expect(
    page.getByRole("heading", { level: 1, name: "Spaces" }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * The terminology card offers "Owner" for "Champion" (METHOD.md terms,
 * decision D6, P9-T21).
 *
 * Offered, never applied: the button fills both fields and the card's own
 * Save decides. **Nothing is saved here**, because every later spec reads
 * "Champion"; the page is left by navigating away, which the unsaved guard
 * allows for a programmatic navigation.
 */
test('the terminology card offers "Champion" for "Owner", and saves nothing by itself', async () => {
  await goTo(page, "/admin/rhythm");
  const terminology = page.getByTestId("rhythm-card-terminology");
  const singular = terminology.locator("input[name='label:champion:singular']");
  const plural = terminology.locator("input[name='label:champion:plural']");
  await expect(singular).toHaveValue("Owner", { timeout: 15_000 });

  await terminology.getByRole("button", { name: "Use “Champion”" }).click();
  await expect(singular).toHaveValue("Champion");
  await expect(plural).toHaveValue("Champions");

  // Nothing was stored: a fresh read still says Owner.
  await goTo(page, "/admin/rhythm");
  await expect(
    page
      .getByTestId("rhythm-card-terminology")
      .locator("input[name='label:champion:singular']"),
  ).toHaveValue("Owner", { timeout: 15_000 });
});
