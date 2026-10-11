import type { Locator } from "@playwright/test";

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
  await picker.fill(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await picker
    .page()
    .getByRole("option", { name: new RegExp(`^${escaped}`) })
    .first()
    .click();
}
