/**
 * The OKR list's title cell holding `value`, as a CSS selector.
 *
 * A title on the list is a textarea that grows with its text since the Goals
 * audit (2 November 2026), so a phone no longer cuts it to "Make …"; the
 * drawer and the diagram card keep a one-line input. An input carries its
 * value as an attribute and a textarea as its text, so the selector names
 * both. `:has-text` is Playwright's, and matches a substring.
 */
export function titleField(
  label: "Objective title" | "Key result title",
  value: string,
): string {
  return `input[aria-label="${label}"][value="${value}"], textarea[aria-label="${label}"]:has-text("${value}")`;
}
