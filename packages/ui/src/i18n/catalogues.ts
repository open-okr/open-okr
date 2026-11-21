/**
 * The full message catalogues for testing, sync checks, and server components.
 *
 * This module imports all locale JSON files. It must NEVER be imported by
 * client components or client provider bundles.
 */
import type { Catalogue, Locale } from "./catalogue.ts";
import en from "./messages/en.json";
import ms from "./messages/ms.json";
import zhHans from "./messages/zh-Hans.json";

/** Preview fixture for the layout before the Arabic catalogue ships (§9). */
export const PSEUDO_RTL = {
  dir: "rtl",
  catalogue: Object.fromEntries(
    Object.entries(en).map(([key, value]) => [key, `\u202e${value}\u202c`]),
  ),
} as const;

export const CATALOGUES: Readonly<
  Record<"en" | "ms" | "pseudo-rtl", Catalogue> &
    Partial<Record<Locale, Catalogue>>
> = { en, ms, "zh-Hans": zhHans, "pseudo-rtl": PSEUDO_RTL.catalogue };

/** Keys present in the source but missing from another locale's catalogue.
 * Empty means every locale is at least "stubbed": present, not necessarily
 * translated. */
export function missingKeys(locale: Locale): readonly string[] {
  const source = CATALOGUES.en;
  const target = CATALOGUES[locale] ?? {};
  return Object.keys(source).filter((key) => !(key in target));
}
