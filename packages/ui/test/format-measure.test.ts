/**
 * `formatMeasure`, the grouping applied to every key result value on screen.
 *
 * The reason the function exists at all: a key result measuring rupiah or
 * impressions reaches nine digits, and `100000000` rendered raw is not
 * distinguishable from `10000000` at a glance. Grouping is the whole fix.
 *
 * The reason it is not `toLocaleString`: a key result value is arbitrary
 * decimal, and `Number.prototype.toLocaleString` rounds to three fraction
 * digits by default. A value of 100000000.12345 would render as
 * "100,000,000.123", which is a number the product never stored. This groups
 * the integer digits and leaves everything after the point exactly as it came.
 */
import { describe, expect, it } from "vitest";
import { formatMeasure } from "../src/lib/format-measure.ts";

describe("formatMeasure", () => {
  const cases: readonly (readonly [number | string, string])[] = [
    // The value this was written for.
    [100000000, "100,000,000"],
    [10000000, "10,000,000"],
    // Grouping starts at four digits, so a three-digit value is untouched.
    [999, "999"],
    [1000, "1,000"],
    [0, "0"],
    // Decimals survive digit for digit. No rounding, no padding.
    [100000000.12345, "100,000,000.12345"],
    [1234.5, "1,234.5"],
    [0.001, "0.001"],
    // A negative measure is legitimate: a reduce key result on net loss.
    [-1234567, "-1,234,567"],
    [-0.5, "-0.5"],
    // Strings arrive straight off a `numeric` column, which is why the
    // signature takes them. Trailing zeros a column kept are kept.
    ["100000000.00", "100,000,000.00"],
    ["1234567", "1,234,567"],
  ];

  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)} as ${expected}`, () => {
      expect(formatMeasure(input)).toBe(expected);
    });
  }

  it("passes a value it cannot parse through unchanged", () => {
    // Total on purpose. A formatter that throws is a formatter that takes a
    // goal page down over one bad row, and the raw value is still readable.
    expect(formatMeasure("not a number")).toBe("not a number");
    expect(formatMeasure(Number.NaN)).toBe("NaN");
    expect(formatMeasure(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("groups the integer part of an exponent-shaped string, or leaves it", () => {
    // `String(1e21)` is "1e+21". Grouping the mantissa would read as a
    // different number, so an exponent is left alone.
    expect(formatMeasure(1e21)).toBe("1e+21");
  });

  it("appends a unit only when there is one", () => {
    expect(formatMeasure(100000000, "IDR")).toBe("100,000,000 IDR");
    expect(formatMeasure(100000000, null)).toBe("100,000,000");
    expect(formatMeasure(100000000, "")).toBe("100,000,000");
    expect(formatMeasure(42, "  ")).toBe("42");
  });
});
