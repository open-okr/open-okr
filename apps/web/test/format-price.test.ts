import { describe, expect, it } from "vitest";
import { formatPrice } from "../lib/format-price.ts";

/** Any provider sets any currency, and nothing in the release names one. */
describe("formatPrice", () => {
  it.each([
    [4900, "usd", "en", "$49.00"],
    [19900, "myr", "en", "MYR 199.00"],
    [4900, "eur", "en", "€49.00"],
    // No decimals in a yen, so this is not 49.
    [4900, "jpy", "en", "¥4,900"],
  ])("writes %i %s", (amount, currency, locale, written) => {
    expect(formatPrice(amount, currency, locale).replace(/ /g, " ")).toBe(
      written,
    );
  });
});
