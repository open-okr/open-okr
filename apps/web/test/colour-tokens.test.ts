import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Every colour utility has to name a token that exists.
 *
 * UIUX-PLAN.md §9 asks that colour goes through a token and never a raw hex.
 * Nothing checked that the token was real, and a Tailwind utility naming a
 * theme key that does not exist is not an error: no rule is generated, so the
 * element simply has no colour. It looks like a token, it passes review, and it
 * renders nothing.
 *
 * Nine of them were live on 2026-09-01, across ten files: `bg-ok-weak`,
 * `bg-bad-weak`, `bg-warn-weak`, `text-ok-text`, `text-bad-text`,
 * `text-warn-text`, `bg-surface-2`, `bg-brand-bg` and `text-on-ok`. The
 * quality panel, the Draft Coach's rule card, the method page, the nudge
 * provenance card, the copilot panel and the quarterly review stepper had all
 * been shipping without their status tinting.
 *
 * The scan covers `packages/ui/src` as well as this app. One scanner rather
 * than a copy in each package, and the direction is legal: this app already
 * depends on `@openokr/ui`.
 */

// From this file rather than the cwd: see page-width.test.ts.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TOKENS = join(ROOT, "packages", "ui", "src", "styles", "tokens.css");

/** Colour words Tailwind supplies itself, which name no token. */
const BUILT_IN = new Set([
  "transparent",
  "current",
  "inherit",
  "black",
  "white",
  "none",
  "auto",
]);

/**
 * The token families this repository defines. Restricting the scan to them
 * keeps it from second-guessing Tailwind's own palette, which the design
 * system does not use but which is still generated.
 */
const FAMILIES =
  /^(ok|bad|warn|info|brand|ink|surface|raised|line|track|on)(-|$)/;

const PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "outline",
  "decoration",
  "accent",
  "caret",
  "divide",
  "placeholder",
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test directories are skipped: this file names every historical
      // offender in its own comment, and a guard that fails on its own
      // documentation is a guard nobody keeps.
      if (!/node_modules|\.next|dist|\.turbo|[\\/]test$|[\\/]e2e$/.test(full)) {
        found.push(...sourceFiles(full));
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe("colour tokens", () => {
  const declared = new Set(
    [...readFileSync(TOKENS, "utf8").matchAll(/--color-([a-z0-9-]+):/g)].map(
      (match) => match[1] as string,
    ),
  );

  test("tokens.css declares the families this test knows about", () => {
    // Guards the guard: a rename in tokens.css that emptied `declared` would
    // otherwise make every assertion below pass vacuously.
    expect(declared.size).toBeGreaterThan(20);
    for (const name of ["ok", "bad", "warn", "brand", "ink", "raised"]) {
      expect(declared.has(name)).toBe(true);
    }
  });

  test("no utility names a colour token that does not exist", () => {
    const pattern = new RegExp(
      `\\b(${PREFIXES.join("|")})-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:/[0-9.]+)?\\b`,
      "g",
    );
    const offenders = new Map<string, Set<string>>();
    const roots = [
      join(ROOT, "apps", "web"),
      join(ROOT, "packages", "ui", "src"),
    ];

    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(pattern)) {
          const name = match[2] as string;
          if (BUILT_IN.has(name) || declared.has(name)) {
            continue;
          }
          if (!FAMILIES.test(name)) {
            continue;
          }
          const key = `${match[1]}-${name}`;
          const where = offenders.get(key) ?? new Set<string>();
          where.add(file.replaceAll("\\", "/").replace(`${ROOT}/`, ""));
          offenders.set(key, where);
        }
      }
    }

    expect(
      [...offenders.entries()].map(
        ([key, where]) => `${key} in ${[...where].join(", ")}`,
      ),
    ).toEqual([]);
  });
});
