/**
 * Pure message-formatting engine and plural selection (languages §5, plan 0.10.0 S3).
 *
 * Free of UI dependencies, so core, web and formats can all share it.
 */
import { intlTagFor, isLocaleCode } from "./locales.ts";

export type Catalogue = Readonly<Record<string, string>>;
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

/** Whether a template contains letters outside named holes. */
export function messageHasLetters(message: string): boolean {
  return /\p{L}/u.test(message.replace(HOLE, ""));
}

/**
 * Plural rule cache per intl tag to avoid recreating Intl.PluralRules instances.
 */
const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale?: string): Intl.PluralRules {
  const tag =
    locale && isLocaleCode(locale) ? intlTagFor(locale) : (locale ?? "en-GB");
  let rules = pluralRulesCache.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRulesCache.set(tag, rules);
  }
  return rules;
}

/** English source templates for the plural categories a locale renders. */
export function catalogueWithLocalePlurals(
  source: Catalogue,
  locale: string,
): Catalogue {
  let categories: readonly string[];
  try {
    categories = getPluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    return source;
  }
  const expanded = { ...source };
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith(".other")) continue;
    const base = key.slice(0, -".other".length);
    for (const category of categories) {
      expanded[`${base}.${category}`] ??= value;
    }
  }
  return expanded;
}

/**
 * Resolves a message template and fills its named holes.
 *
 * Supports plural selection with `Intl.PluralRules` when `values.count` is a number:
 * looks up `<key>.<category>` first (e.g. `.zero`, `.one`, `.two`, `.few`, `.many`, `.other`),
 * falling back to `<key>.other`, and finally `<key>`.
 */
export function translate(
  catalogue: Catalogue,
  key: string,
  values?: MessageValues,
  fillHole?: (name: string) => string | undefined,
  locale?: string,
): string {
  let resolvedKey = key;
  let isPlural = false;

  if (values && typeof values.count === "number") {
    const category = getPluralRules(locale).select(values.count);
    const categoryKey = `${key}.${category}`;
    const otherKey = `${key}.other`;

    if (categoryKey in catalogue) {
      resolvedKey = categoryKey;
      isPlural = true;
    } else if (otherKey in catalogue) {
      resolvedKey = otherKey;
      isPlural = true;
    }
  }

  const value = catalogue[resolvedKey];
  if (value === undefined) {
    throw new Error(`No catalogue entry for "${key}".`);
  }

  const every = messageHoles(value);
  if (every.length === 0 && values === undefined) {
    return value;
  }

  // Filter out holes filled by custom filler (e.g. term holes in packages/ui)
  const holes = fillHole
    ? every.filter((hole) => fillHole(hole) === undefined)
    : every;
  const supplied = values ?? {};

  const missing = holes.filter((hole) => !(hole in supplied));
  if (missing.length > 0) {
    throw new Error(
      `The message "${key}" has no value for ${missing.map((one) => `{${one}}`).join(", ")}.`,
    );
  }

  // Unused values check: count is allowed to be unused in .one or other plural categories (e.g. "One item")
  const unused = Object.keys(supplied).filter(
    (name) => !holes.includes(name) && !(isPlural && name === "count"),
  );
  if (unused.length > 0) {
    throw new Error(
      `The message "${key}" has no hole for ${unused.join(", ")}.`,
    );
  }

  return value.replace(
    HOLE,
    (_, name: string) => fillHole?.(name) ?? String(supplied[name]),
  );
}
