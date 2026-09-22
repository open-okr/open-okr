/**
 * How a key result value, baseline or target is written on screen.
 *
 * **Why this is not `toLocaleString`.** A key result value is stored in an
 * unbounded `numeric` column and can carry any number of decimal places.
 * `Number.prototype.toLocaleString` rounds to three fraction digits unless
 * told otherwise, so a stored 100000000.12345 would render as
 * "100,000,000.123": a number the product never held. Grouping the integer
 * digits and leaving the fraction untouched cannot round anything.
 *
 * **Why a fixed separator rather than the viewer's locale.** These values are
 * rendered in server components. A locale-dependent separator resolved on the
 * server and again in the browser is a hydration mismatch waiting for the
 * first viewer whose machine disagrees with the request. The comma matches the
 * only existing precedent in the product, the `en-GB` grouping on the AI
 * governance and model cards.
 *
 * **Total.** An input it cannot parse comes back as it arrived. A formatter
 * that throws is a formatter that takes a goal page down over one bad row, and
 * the ungrouped value is still readable.
 */

/**
 * A sign, the integer digits, and an optional fraction. Every quantifier here
 * is simple and the pattern is anchored at both ends, so there is nothing for
 * a backtracking engine to explore.
 */
const GROUPABLE = /^(-?)(\d+)(\.\d+)?$/;

/**
 * Commas every three digits from the right, by counting rather than by
 * pattern.
 *
 * The one-line regular expression for this is `\B(?=(\d{3})+(?!\d))`, and it
 * carries a quantified group inside a lookahead. That is the shape CodeQL's
 * `js/polynomial-redos` query reports, and a comment saying the input is
 * digit-only would not stop it: the query reasons about the pattern, not about
 * the caller. Counting is also faster and easier to read.
 */
function group(digits: string): string {
  const lead = digits.length % 3 || 3;
  let out = digits.slice(0, lead);
  for (let at = lead; at < digits.length; at += 3) {
    out += `,${digits.slice(at, at + 3)}`;
  }
  return out;
}

export function formatMeasure(
  value: number | string,
  unit?: string | null,
): string {
  const raw = typeof value === "number" ? String(value) : value;
  const match = GROUPABLE.exec(raw.trim());
  // Anything else (a word, NaN, Infinity, an exponent like "1e+21") passes
  // through. Grouping an exponent's mantissa would read as a different number.
  const formatted =
    match === null
      ? raw
      : `${match[1] ?? ""}${group(match[2] ?? "")}${match[3] ?? ""}`;
  const suffix = unit?.trim();
  return suffix ? `${formatted} ${suffix}` : formatted;
}
