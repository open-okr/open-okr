import { expect, type Locator } from "@playwright/test";

/**
 * Choosing in an `EntityPicker` (docs/design/guided-inputs.md §4.10) the way
 * a person does: open it, type, and press the match. The picker is a
 * combobox, not a native select, so Playwright's `selectOption` has nothing
 * to select.
 */

/**
 * Opens a picker and hands back its box as the one open combobox.
 *
 * **Not the locator it was found by.** While a list is open, the rest of the
 * page is hidden from the accessibility tree, as a dialog's is, so a locator
 * such as "the second Owner box" stops resolving the moment that box opens.
 * Typing waits for the list to be open, as somebody sees it open: typing in
 * the instant before it was put back to the stored choice's name.
 */
async function open(picker: Locator): Promise<Locator> {
  await picker.click();
  const box = picker.page().getByRole("combobox", { expanded: true });
  await expect(box).toHaveCount(1);
  return box;
}

/**
 * Chooses the option whose name starts with `name`, because a member's
 * option reads on with their title.
 */
export async function choose(picker: Locator, name: string): Promise<void> {
  const box = await open(picker);
  await box.fill(name);
  await expect(box).toHaveValue(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await box
    .page()
    .getByRole("option", { name: new RegExp(`^${escaped}`) })
    .first()
    .click();
}

/**
 * Chooses the option at `index` in the order the picker offers them, for a
 * spec that does not mind which: index 0 is "Nobody" where the picker offers
 * it.
 */
export async function chooseAt(picker: Locator, index: number): Promise<void> {
  const box = await open(picker);
  await box.page().getByRole("option").nth(index).click();
}

/**
 * Chooses the first option whose name holds `text`, for a spec that knows
 * part of a name: a key result titled after the KPI it answers.
 */
export async function chooseContaining(
  picker: Locator,
  text: string,
): Promise<void> {
  const box = await open(picker);
  await box.fill(text);
  await expect(box).toHaveValue(text);
  await box.page().getByRole("option").filter({ hasText: text }).first().click();
}

/** The names a picker offers, read with its list open and closed again. */
export async function offered(picker: Locator): Promise<string[]> {
  const box = await open(picker);
  const page = box.page();
  await expect(page.getByRole("option").first()).toBeVisible();
  const names = await page.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  return names;
}
