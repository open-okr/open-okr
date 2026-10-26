import type { Locator } from "@playwright/test";

/**
 * Sets a `TokenInput` (docs/design/guided-inputs.md §4.11) to exactly these
 * entries the way a person would: each chip taken back with its own button,
 * then the new entries typed and committed with Enter. `box` is the field's
 * text box, as its label finds it.
 */
export async function setTokens(
  box: Locator,
  entries: readonly string[],
): Promise<void> {
  // The chips sit in the same bordered row as the box.
  const row = box.locator("xpath=..");
  const remove = row.getByRole("button", { name: /^Remove / });
  while ((await remove.count()) > 0) {
    await remove.first().click();
  }
  if (entries.length > 0) {
    // A comma separates in every field, where a space does not in a list of
    // terms that can be two words.
    await box.fill(entries.join(", "));
    await box.press("Enter");
  }
}
