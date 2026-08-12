/**
 * The message-catalogue pipeline (UIUX-PLAN.md §8, P2-T10 item 8).
 *
 * English is the source; every other locale's catalogue must carry the
 * same key set (`missingKeys`/`assertSameKeys` below), which is what "keys
 * stubbed" means for Bahasa Melayu here — the module lists it as a
 * follow-up to have its actual translations reviewed by a speaker, but the
 * keys exist and resolve to something today rather than falling back
 * silently, which is a different, larger failure than a wrong word choice.
 *
 * Scope today: only the strings this task's own shell components
 * (`ShortcutOverlay`, `TopbarSearch`, the mobile tab bar) actually render.
 * §8 wants every user-facing string in a catalogue; there is barely any UI
 * yet for that to mean more than this until Phase 3 and 4 build screens
 * with real text of their own — each one adds its own keys the same way,
 * rather than this task inventing placeholders for screens that do not
 * exist.
 */
import en from "./messages/en.json";
import ms from "./messages/ms.json";

export type Catalogue = Readonly<Record<string, string>>;
export type Locale = "en" | "ms";

export const CATALOGUES: Readonly<Record<Locale, Catalogue>> = { en, ms };

export const SOURCE_LOCALE: Locale = "en";

/** Keys present in the source but missing from another locale's catalogue.
 * Empty means every locale is at least "stubbed": present, not necessarily
 * translated. */
export function missingKeys(locale: Locale): readonly string[] {
  const source = CATALOGUES[SOURCE_LOCALE];
  const target = CATALOGUES[locale];
  return Object.keys(source).filter((key) => !(key in target));
}

export function translate(catalogue: Catalogue, key: string): string {
  const value = catalogue[key];
  if (value === undefined) {
    // A missing key is a build-time defect (missingKeys above catches it
    // for every non-source locale before this ever runs), not a runtime
    // one to hide behind a fallback string that looks like real content.
    throw new Error(`No catalogue entry for "${key}".`);
  }
  return value;
}

const PSEUDO_ACCENTS: Readonly<Record<string, string>> = {
  a: "ä",
  e: "ë",
  i: "ï",
  o: "ö",
  u: "ü",
  A: "Ä",
  E: "Ë",
  I: "Ï",
  O: "Ö",
  U: "Ü",
};

/**
 * §8's "pseudo-locale build check": every catalogue value, transformed so
 * it is both clearly-not-English and reliably longer (accented vowels
 * plus ~30% padding, wrapped in brackets). Any text rendered while this
 * locale is active that is *not* one of these wrapped, accented strings
 * did not come from the catalogue — see `findUnwrappedText` below, the
 * other half of the check.
 */
export function toPseudoLocale(value: string): string {
  const accented = value.replace(
    /[aeiouAEIOU]/g,
    (letter) => PSEUDO_ACCENTS[letter] ?? letter,
  );
  const padding = "~".repeat(Math.max(1, Math.ceil(value.length * 0.3)));
  return `[${accented}${padding}]`;
}

export function buildPseudoCatalogue(
  source: Catalogue = CATALOGUES[SOURCE_LOCALE],
): Catalogue {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, toPseudoLocale(value)]),
  );
}

/**
 * The other half of the pseudo-locale check: scans rendered text for a
 * run of two or more letters that sits outside every `[...]` pseudo
 * wrapper. A component that renders such a run while the pseudo locale is
 * active printed a string it did not source from the catalogue — the
 * literal hardcoded-string defect §8's CI check exists to catch, proven
 * directly in `catalogue.test.ts` rather than only asserted about.
 */
export function findUnwrappedText(renderedText: string): readonly string[] {
  const withoutWrapped = renderedText.replace(/\[[^\]]*\]/g, " ");
  const matches = withoutWrapped.match(/[A-Za-z]{2,}/g) ?? [];
  return matches;
}
