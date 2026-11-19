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
 * **Locale-aware grouping.** The locale is passed explicitly. The integer digits
 * are formatted through `Intl.NumberFormat` with BigInt, respecting CLDR rules
 * (e.g. four-digit numbers in Spanish and Italian are not grouped, French uses
 * a narrow no-break space, German uses periods, Arabic uses Latin digits with commas).
 * The decimal separator matches the locale.
 *
 * **Total.** An input it cannot parse comes back as it arrived. A formatter
 * that throws is a formatter that takes a goal page down over one bad row, and
 * the ungrouped value is still readable.
 */

import { intlTagFor } from "@openokr/formats";

/**
 * A sign, the integer digits, and an optional fraction. Every quantifier here
 * is simple and the pattern is anchored at both ends, so there is nothing for
 * a backtracking engine to explore.
 */
const GROUPABLE = /^(-?)(\d+)(\.\d+)?$/;

const FORMATTER_CACHE = new Map<string, Intl.NumberFormat>();

function getFormatter(tag: string): Intl.NumberFormat {
  let formatter = FORMATTER_CACHE.get(tag);
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag);
    FORMATTER_CACHE.set(tag, formatter);
  }
  return formatter;
}

export function formatMeasure(
  value: number | string,
  unit?: string | null,
  locale?: string | null,
): string {
  const raw = typeof value === "number" ? String(value) : value;
  const match = GROUPABLE.exec(raw.trim());
  if (match === null) {
    const suffix = unit?.trim();
    return suffix ? `${raw} ${suffix}` : raw;
  }

  const sign = match[1] ?? "";
  const integerDigits = match[2] ?? "";
  const fractionPart = match[3] ?? "";

  const tag = intlTagFor(locale);
  const formatter = getFormatter(tag);

  const formattedInteger = formatter.format(BigInt(integerDigits));

  let formattedFraction = "";
  if (fractionPart) {
    const parts = formatter.formatToParts(1.1);
    const decimalSep = parts.find((p) => p.type === "decimal")?.value ?? ".";
    formattedFraction = `${decimalSep}${fractionPart.slice(1)}`;
  }

  const formatted = `${sign}${formattedInteger}${formattedFraction}`;
  const suffix = unit?.trim();
  return suffix ? `${formatted} ${suffix}` : formatted;
}
