import { expect, type Locator } from "@playwright/test";

/**
 * Chooses an option in an `EntityPicker` (docs/design/guided-inputs.md
 * §4.10) the way a person does: types its name into the box and presses the
 * match. The picker is a combobox, not a native select, so Playwright's
 * `selectOption` has nothing to select.
 *
 * Matched from the start of the option's name, because a member's option
 * reads on with their title.
 */
export async function choose(picker: Locator, name: string): Promise<void> {
  await picker.click();
  // Typed once the list is open, as somebody sees it open: typing in the
  // instant before it does was put back to the stored choice's name as the
  // list finished opening.
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await picker.fill(name);
  await expect(picker).toHaveValue(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await picker
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
  await picker.click();
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await picker.page().getByRole("option").nth(index).click();
}
