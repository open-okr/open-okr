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
 */
import {
  type Catalogue,
  translate as formatTranslate,
  type MessageValues,
  messageHoles,
} from "@openokr/formats";
import type { TerminologyOverrides } from "@openokr/method";
import en from "./messages/en.json";
import { fillTermHole } from "./terms.ts";

export { type Catalogue, type MessageValues, messageHoles };

export type Locale = "en" | "ms";

export const SOURCE_LOCALE: Locale = "en";

/**
 * The message, with its holes filled.
 *
 * `renamed` is the workspace's own words for the method's terms (M-14). A term
 * hole such as `{termObjective}` is filled from it, or from the catalogue's own
 * word for the term when the workspace renamed nothing, so a caller never
 * passes a term as a value. See `terms.ts`.
 */
export function translate(
  catalogue: Catalogue,
  key: string,
  values?: MessageValues,
  renamed?: TerminologyOverrides,
  locale?: string,
): string {
  const fillHole = (name: string) => fillTermHole(catalogue, name, renamed);
  return formatTranslate(catalogue, key, values, fillHole, locale);
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

export function buildPseudoCatalogue(source: Catalogue = en): Catalogue {
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
  // Innermost first, until nothing is left to strip, because a term hole puts
  // one wrapped entry inside another: "[Nëw [späcë~~]~~~]" (M-14). Stripping
  // outer pairs in one pass would leave the tail of the outer one behind and
  // report it as text that never came from the catalogue.
  let withoutWrapped = renderedText;
  for (;;) {
    const stripped = withoutWrapped.replace(/\[[^[\]]*\]/g, " ");
    if (stripped === withoutWrapped) {
      break;
    }
    withoutWrapped = stripped;
  }
  const matches = withoutWrapped.match(/[A-Za-z]{2,}/g) ?? [];
  return matches;
}
