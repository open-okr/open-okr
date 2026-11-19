/**
 * The full message catalogues for testing, sync checks, and server components.
 *
 * This module imports all locale JSON files. It must NEVER be imported by
 * client components or client provider bundles.
 */
import type { Catalogue, Locale } from "./catalogue.ts";
import { SOURCE_LOCALE } from "./catalogue.ts";
import en from "./messages/en.json";
import ms from "./messages/ms.json";

export const CATALOGUES: Readonly<Record<Locale, Catalogue>> = { en, ms };

/** Keys present in the source but missing from another locale's catalogue.
 * Empty means every locale is at least "stubbed": present, not necessarily
 * translated. */
export function missingKeys(locale: Locale): readonly string[] {
  const source = CATALOGUES[SOURCE_LOCALE];
  const target = CATALOGUES[locale];
  return Object.keys(source).filter((key) => !(key in target));
}
