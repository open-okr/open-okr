import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * No screen builds an English plural in code (completeness review M-15).
 *
 * Twenty-eight places wrote `n === 1 ? "" : "s"` beside a word, or chose
 * "is" or "are", and passed the result into a message or straight onto the
 * screen. Malay has no plural suffix, so the translated catalogue still read
 * "3 keputusan utamas". A count now picks a whole message: a `…One` and a
 * `…Other` key, or the shared `common.count.*` phrases.
 */
const roots = [
  fileURLToPath(new URL("../app", import.meta.url)),
  fileURLToPath(new URL("../lib", import.meta.url)),
  fileURLToPath(new URL("../../../packages/ui/src", import.meta.url)),
];

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".next" && entry.name !== "node_modules") {
        found.push(...sources(path));
      }
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

const INFLECTION =
  /===\s*-?1\s*\?\s*"(?:|s|es|is|y)"\s*:\s*"(?:s|es|are|ies|)"|\?\s*"s"\s*:\s*""/;

describe("English plurals", () => {
  test("no source chooses a plural suffix or is/are in code", () => {
    const offenders = roots
      .flatMap(sources)
      .filter((path) => INFLECTION.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("the pattern still recognises the shape it is looking for", () => {
    expect(INFLECTION.test('n === 1 ? "" : "s"')).toBe(true);
    expect(INFLECTION.test('n === 1 ? "is" : "are"')).toBe(true);
    expect(INFLECTION.test('n === 1 ? t("a.one") : t("a.other")')).toBe(false);
  });
});
