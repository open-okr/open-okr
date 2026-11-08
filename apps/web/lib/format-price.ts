/**
 * A provider's price, as a reader of this language writes it.
 *
 * Nothing here knows a currency: the code comes from the provider, and `Intl` knows
 * how many decimals it has, which is what turns an amount in the minor unit into
 * something to read. A yen has none, so 4900 is 4,900 yen rather than 49.
 */
export function formatPrice(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  const code = currency.toUpperCase();
  const decimals =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
  }).format(amountMinor / 10 ** decimals);
}
