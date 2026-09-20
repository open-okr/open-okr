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
 * **A message carries values, and a sentence stays whole** (P6-G22d-a). The
 * move split every sentence that interleaved with an expression, because
 * `translate` took a key and nothing else: a catalogue held entries like "at"
 * and "minutes. A shorter window means…" on either side of a number. Word
 * order differs between languages, so a translator handed the piece "at" has
 * no way to know what it attaches to. A message now says `{hour}` where the
 * value goes and the translator moves the hole to wherever their own language
 * needs it.
 *
 * **Named holes and nothing else.** No plural selection, no number or date
 * formatting, no nesting: that is ICU MessageFormat, and it is a library, a
 * parser and a dependency. What these sentences need is a hole with a name in
 * it. A sentence whose wording changes with a count picks its key at the call
 * site instead, which is visible in the source rather than hidden in a format
 * string.
 *
 * **213 keys are still fragments, in 319 places across 85 files.** They are
 * listed by name in `apps/web/test/fragmented-messages.ts` as a debt that only
 * shrinks, and emptying it is P6-G22d-b. The machinery above is what makes
 * emptying it possible.
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

/** What a message's named holes are filled with. */
export type MessageValues = Readonly<Record<string, string | number>>;

/**
 * A named hole: `{count}`, `{champion}`.
 *
 * Deliberately narrow. `${a}` inside a message is a template literal somebody
 * is describing rather than a hole, and `{` followed by anything that is not
 * an identifier stays the character it is.
 */
const HOLE = /(?<!\$)\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** The holes a message has, in the order it has them, without duplicates. */
export function messageHoles(message: string): readonly string[] {
  return [
    ...new Set([...message.matchAll(HOLE)].map((match) => match[1] ?? "")),
  ];
}

export function translate(
  catalogue: Catalogue,
  key: string,
  values?: MessageValues,
): string {
  const value = catalogue[key];
  if (value === undefined) {
    // A missing key is a build-time defect (missingKeys above catches it
    // for every non-source locale before this ever runs), not a runtime
    // one to hide behind a fallback string that looks like real content.
    throw new Error(`No catalogue entry for "${key}".`);
  }

  const holes = messageHoles(value);
  if (holes.length === 0 && values === undefined) {
    return value;
  }

  const supplied = values ?? {};
  // **Both directions, and the second one is the useful one.** A missing value
  // would render "{count}" on a screen, which is the defect this replaces. A
  // value nobody asked for means the message was reworded and its hole
  // renamed, which otherwise fails silently in one locale at a time.
  const missing = holes.filter((hole) => !(hole in supplied));
  if (missing.length > 0) {
    throw new Error(
      `The message "${key}" has no value for ${missing.map((one) => `{${one}}`).join(", ")}.`,
    );
  }
  const unused = Object.keys(supplied).filter((name) => !holes.includes(name));
  if (unused.length > 0) {
    throw new Error(
      `The message "${key}" has no hole for ${unused.join(", ")}.`,
    );
  }

  return value.replace(HOLE, (_, name: string) => String(supplied[name]));
}

/** Splits a message into its holes and the text between them. */
const HOLE_SPLIT = /((?<!\$)\{[A-Za-z][A-Za-z0-9]*\})/;
const HOLE_WHOLE = /^\{[A-Za-z][A-Za-z0-9]*\}$/;

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
  // **A hole is left alone** (P6-G22d). Accenting `{count}` into `{cöünt}`
  // would make every parameterised message throw under the one check whose
  // job is to find defects rather than to cause them.
  const accented = value
    .split(HOLE_SPLIT)
    .map((part) =>
      HOLE_WHOLE.test(part)
        ? part
        : part.replace(
            /[aeiouAEIOU]/g,
            (letter) => PSEUDO_ACCENTS[letter] ?? letter,
          ),
    )
    .join("");
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
