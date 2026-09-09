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
 * **Scope: every user-facing string in the application** (P6-G22c). It was
 * seven keys and three components until 9 September 2026, when the 1,543
 * strings the gap audit found hardcoded across 146 route files moved in. §8
 * asks for exactly that, and `apps/web/test/catalogue-coverage.test.ts`
 * refuses a new one written outside it.
 *
 * **Four keys were removed on 7 September 2026 because nothing read them.**
 * `shell.mobile.home`, `.review`, `.inbox` and `.search` were written for the
 * mobile tab bar, which takes its labels from the module registry instead, and
 * `.inbox` named a screen that has never existed. A key with no consumer is a
 * translation somebody pays for and nobody sees. That is a test now, in
 * `catalogue-coverage.test.ts`, and the first thing it found was
 * `shell.version.updateAvailable`: written at P2-T10 for UIUX-PLAN §3's "one
 * reload with a clear message" and never rendered, because the watcher threw
 * away the `stale` its own hook returned.
 *
 * **A key is named after the screen that says it, and `common.` is what two
 * screens share.** The move generated a key per string from its own file's
 * path, which is right until a second screen says the same words: "Save" would
 * otherwise be `cycle.admin.save` and read by fifteen files. 124 keys used in
 * more than one place moved to `common.`, and the file is sorted, because a
 * catalogue of 1,354 entries that nobody can find a key in is a catalogue
 * nobody maintains.
 *
 * **187 of the 1,354 values are sentence fragments, and that is a known
 * defect** (P6-G22d). A sentence with a number or a name in the middle of it
 * became several keys on either side of the interpolation, so a catalogue now
 * holds entries like "at" and "minutes. A shorter window means…". Word order
 * differs between languages and a translator cannot put those back together.
 * Fixing it needs parameters in a message, which `translate` does not have and
 * which is a design decision rather than a mechanical one.
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
