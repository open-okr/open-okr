/**
 * Pure check functions and sync engine for catalogue coverage, holes, plurals,
 * and English-match ledgers (docs/design/languages.md §6.1, §6.2).
 */
import { type Catalogue, messageHoles } from "@openokr/formats";
import { isTermHole } from "./terms.ts";

export interface CheckIssue {
  readonly locale: string;
  readonly key?: string;
  readonly check:
    | "keys"
    | "holes"
    | "plurals"
    | "english-copies"
    | "ledger"
    | "reasons"
    | "scripts"
    | "release";
  readonly message: string;
}

export interface CheckOptions {
  readonly release?: boolean;
}

const HAN_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const ARABIC_REGEX = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
const LETTER_REGEX = /[A-Za-z]/;

function comparableHoles(
  message: string,
  isOneCategory = false,
): readonly string[] {
  const holes = messageHoles(message)
    .filter((hole) => !isOneCategory || hole !== "count")
    .map((hole) => (isTermHole(hole) ? hole.replace(/Lower$/, "") : hole));
  return [...new Set(holes)].sort();
}

/** Check 1: Keys - Target has exact same keys as source */
export function checkKeys(
  locale: string,
  sourceKeys: readonly string[],
  targetKeys: readonly string[],
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const sourceSet = new Set(sourceKeys);
  const targetSet = new Set(targetKeys);

  for (const key of sourceKeys) {
    if (!targetSet.has(key)) {
      issues.push({
        locale,
        key,
        check: "keys",
        message: `Missing key in ${locale}: ${key}`,
      });
    }
  }

  for (const key of targetKeys) {
    if (!sourceSet.has(key)) {
      issues.push({
        locale,
        key,
        check: "keys",
        message: `Extra key in ${locale} that does not exist in English: ${key}`,
      });
    }
  }

  return issues;
}

/** Check 2: Holes - A value's named holes differ from English */
export function checkHoles(
  locale: string,
  source: Catalogue,
  target: Catalogue,
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    if (targetValue === undefined) {
      continue;
    }
    const isOne = key.endsWith(".one");
    const sourceHoles = comparableHoles(sourceValue, isOne);
    const targetHoles = comparableHoles(targetValue, isOne);

    if (sourceHoles.join(",") !== targetHoles.join(",")) {
      issues.push({
        locale,
        key,
        check: "holes",
        message: `Holes mismatch for ${key} in ${locale}: expected [${sourceHoles.join(", ")}], got [${targetHoles.join(", ")}]`,
      });
    }
  }

  return issues;
}

/** Check 3: Plurals - A base key lacks a category its locale needs */
export function checkPlurals(
  locale: string,
  intlTag: string,
  source: Catalogue,
  target: Catalogue,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  let requiredCategories: readonly string[];
  try {
    requiredCategories = new Intl.PluralRules(intlTag).resolvedOptions()
      .pluralCategories;
  } catch {
    requiredCategories = ["other"];
  }

  // Find plural base keys in source (every plural in English has .other)
  const pluralBases = new Set<string>();
  for (const key of Object.keys(source)) {
    if (key.endsWith(".other")) {
      pluralBases.add(key.slice(0, key.length - ".other".length));
    }
  }

  for (const base of pluralBases) {
    for (const category of requiredCategories) {
      const fullKey = `${base}.${category}`;
      if (target[fullKey] === undefined) {
        issues.push({
          locale,
          key: base,
          check: "plurals",
          message: `Plural base key '${base}' lacks required category '${category}' for locale ${locale} (${fullKey})`,
        });
      }
    }
  }

  return issues;
}

/** Check 4: English copies - A value equals English without entry in same-as-english or pending */
export function checkEnglishCopies(
  locale: string,
  source: Catalogue,
  target: Catalogue,
  sameAsEnglish: Record<string, string>,
  pending: readonly string[],
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const pendingSet = new Set(pending);

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    if (targetValue === undefined) {
      continue;
    }
    if (targetValue === sourceValue) {
      if (!sameAsEnglish[key] && !pendingSet.has(key)) {
        issues.push({
          locale,
          key,
          check: "english-copies",
          message: `Value for '${key}' in ${locale} equals English but is not listed in same-as-english.ts or pending.json`,
        });
      }
    }
  }

  return issues;
}

/** Check 5: Ledger - pending.json entry names key that no longer exists or whose value != English */
export function checkLedger(
  locale: string,
  source: Catalogue,
  target: Catalogue,
  pending: readonly string[],
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  for (const key of pending) {
    if (source[key] === undefined || target[key] === undefined) {
      issues.push({
        locale,
        key,
        check: "ledger",
        message: `pending.json lists key '${key}' for ${locale}, but key does not exist in catalogue`,
      });
      continue;
    }
    if (target[key] !== source[key]) {
      issues.push({
        locale,
        key,
        check: "ledger",
        message: `pending.json lists key '${key}' for ${locale}, but its value is already translated and no longer equals English`,
      });
    }
  }

  return issues;
}

/** Check 6: Reasons - same-as-english entry has empty reason or value differs from English */
export function checkReasons(
  locale: string,
  source: Catalogue,
  target: Catalogue,
  sameAsEnglish: Record<string, string>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  for (const [key, reason] of Object.entries(sameAsEnglish)) {
    if (!reason || reason.trim().length === 0) {
      issues.push({
        locale,
        key,
        check: "reasons",
        message: `same-as-english.ts entry for '${key}' in ${locale} has an empty reason`,
      });
    }
    if (source[key] === undefined || target[key] === undefined) {
      issues.push({
        locale,
        key,
        check: "reasons",
        message: `same-as-english.ts entry '${key}' for ${locale} does not exist in catalogue`,
      });
      continue;
    }
    if (target[key] !== source[key]) {
      issues.push({
        locale,
        key,
        check: "reasons",
        message: `same-as-english.ts entry '${key}' for ${locale} differs from English: expected '${source[key]}', got '${target[key]}'`,
      });
    }
  }

  return issues;
}

/** Check 7: Scripts - zh-Hans text must contain Han, ar must contain Arabic */
export function checkScripts(
  locale: string,
  target: Catalogue,
  sameAsEnglish: Record<string, string>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  if (locale === "zh-Hans") {
    for (const [key, value] of Object.entries(target)) {
      if (sameAsEnglish[key]) {
        continue;
      }
      if (LETTER_REGEX.test(value) && !HAN_REGEX.test(value)) {
        issues.push({
          locale,
          key,
          check: "scripts",
          message: `Simplified Chinese value for '${key}' contains letters but no Han character: "${value}"`,
        });
      }
    }
  } else if (locale === "ar") {
    for (const [key, value] of Object.entries(target)) {
      if (sameAsEnglish[key]) {
        continue;
      }
      if (LETTER_REGEX.test(value) && !ARABIC_REGEX.test(value)) {
        issues.push({
          locale,
          key,
          check: "scripts",
          message: `Arabic value for '${key}' contains letters but no Arabic character: "${value}"`,
        });
      }
    }
  }

  return issues;
}

/** Check 8: Release mode - fails when pending.json is not empty */
function checkRelease(
  pending: Record<string, readonly string[]>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  let totalPending = 0;
  const localesWithPending: string[] = [];

  for (const [locale, keys] of Object.entries(pending)) {
    if (keys && keys.length > 0) {
      totalPending += keys.length;
      localesWithPending.push(`${locale} (${keys.length} keys)`);
    }
  }

  if (totalPending > 0) {
    issues.push({
      locale: "all",
      check: "release",
      message: `Release gate failed: pending.json is not empty (${totalPending} keys pending: ${localesWithPending.join(", ")})`,
    });
  }

  return issues;
}

/** Full catalogue checker */
export function checkCatalogues(
  source: Catalogue,
  catalogues: Record<string, Catalogue>,
  sameAsEnglish: Record<string, Record<string, string>>,
  pending: Record<string, readonly string[]>,
  options?: CheckOptions,
): readonly CheckIssue[] {
  const issues: CheckIssue[] = [];
  const sourceKeys = Object.keys(source);

  if (options?.release) {
    issues.push(...checkRelease(pending));
  }

  for (const [locale, target] of Object.entries(catalogues)) {
    const localeSame = sameAsEnglish[locale] ?? {};
    const localePending = pending[locale] ?? [];
    const targetKeys = Object.keys(target);

    issues.push(...checkKeys(locale, sourceKeys, targetKeys));
    issues.push(...checkHoles(locale, source, target));
    // Plural check with intlTag if known
    issues.push(...checkPlurals(locale, locale, source, target));
    issues.push(
      ...checkEnglishCopies(locale, source, target, localeSame, localePending),
    );
    issues.push(...checkLedger(locale, source, target, localePending));
    issues.push(...checkReasons(locale, source, target, localeSame));
    issues.push(...checkScripts(locale, target, localeSame));
  }

  return issues;
}

/**
 * Syncs a single target catalogue with the source English catalogue (§6.1).
 *
 * Copies new English keys into the target catalogue and records them in pending.
 * Removes keys deleted from English from target and pending.
 */
export function syncCatalogue(
  _locale: string,
  source: Catalogue,
  target: Catalogue,
  pending: readonly string[],
): {
  readonly updatedTarget: Catalogue;
  readonly updatedPending: string[];
  readonly added: string[];
  readonly removed: string[];
} {
  const updatedTarget: Record<string, string> = { ...target };
  const pendingSet = new Set(pending);
  const added: string[] = [];
  const removed: string[] = [];

  // Add missing keys from source
  for (const [key, sourceValue] of Object.entries(source)) {
    if (updatedTarget[key] === undefined) {
      updatedTarget[key] = sourceValue;
      pendingSet.add(key);
      added.push(key);
    }
  }

  // Remove keys deleted from source
  for (const key of Object.keys(updatedTarget)) {
    if (source[key] === undefined) {
      delete updatedTarget[key];
      pendingSet.delete(key);
      removed.push(key);
    }
  }

  return {
    updatedTarget,
    updatedPending: Array.from(pendingSet).sort(),
    added,
    removed,
  };
}
