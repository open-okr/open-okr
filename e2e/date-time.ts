import type { Locator } from "@playwright/test";

/**
 * Fills a `DateTimeInput` (docs/design/guided-inputs.md §4.9) the way a person
 * does: the date, then the time. The field is a group named by its label, and
 * its two controls are named "<label>: date" and "<label>: time". A plain
 * `getByLabel(label)` matches both by substring, so name each part exactly.
 *
 * `value` is the local form `YYYY-MM-DDTHH:MM`, without an offset.
 */
export async function fillDateTime(
  scope: Pick<Locator, "getByLabel">,
  label: string,
  value: string,
): Promise<void> {
  const [date = "", time = ""] = value.split("T");
  await scope.getByLabel(`${label}: date`, { exact: true }).fill(date);
  await scope.getByLabel(`${label}: time`, { exact: true }).fill(time);
}
