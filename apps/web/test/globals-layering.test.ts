import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * A bare rule in `globals.css` silently beats every Tailwind utility.
 *
 * Tailwind v4 emits its utilities inside `@layer utilities`. A rule declared
 * outside any layer wins over every layered rule regardless of specificity, so
 * `* { border-color: var(--color-line) }` at the top level made every
 * `border-<colour>` utility in the product dead: 34 of them, including
 * `border-brand` fourteen times and `border-brand-line` six, all rendering as
 * the neutral hairline.
 *
 * It fails silently and it fails everywhere, which is the combination worth a
 * test. Measured in Chrome 151 on 2026-09-01: `border border-bad-dot`,
 * `border border-ok-dot` and `border border-bad` all computed to
 * `rgb(228, 233, 242)`, which is `--line`.
 */

const GLOBALS = join(process.cwd(), "app", "globals.css");

describe("globals.css layering", () => {
  const source = readFileSync(GLOBALS, "utf8");

  test("declares no rule outside a layer", () => {
    // Strip layer and at-rule blocks, then look for anything left that opens a
    // declaration block. `@import`, `@source` and `@theme` are directives, not
    // rules competing with utilities.
    const withoutLayers = source.replace(
      /@layer[^{]*\{[\s\S]*?\n\}/g,
      "",
    );
    const stray = [
      ...withoutLayers.matchAll(/^([^@\s][^{}\n]*)\{/gm),
    ].map((match) => (match[1] as string).trim());
    expect(stray).toEqual([]);
  });

  test("the universal border colour is inside a layer", () => {
    // The specific rule that caused it, named so a reintroduction is obvious
    // rather than a puzzle.
    const index = source.indexOf("border-color");
    expect(index).toBeGreaterThan(-1);
    const before = source.slice(0, index);
    const opened = (before.match(/@layer[^{]*\{/g) ?? []).length;
    expect(opened).toBeGreaterThan(0);
  });
});
