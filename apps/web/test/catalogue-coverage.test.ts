import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGUES, missingKeys } from "@openokr/ui";
import { describe, expect, test } from "vitest";
import {
  findUnlocalisedIn,
  findUnlocalisedStrings,
} from "./catalogue-coverage.ts";
import { UNLOCALISED_FILES } from "./unlocalised-files.ts";

/**
 * A hardcoded string fails the build (UIUX-PLAN §8, P6-G22b).
 *
 * **The catalogue could be bypassed by accident, and mostly was.** P2-T10 built
 * it and the pseudo-locale check that proves a rendered component sources its
 * text from it, and that check covered three shell components. The gap audit of
 * 7 September 2026 found every route hardcoding its strings; measured here, 146
 * files held 1,543 of them.
 *
 * **A render check cannot be extended to a route.** The existing one in
 * `packages/ui` renders a component under a pseudo catalogue and looks for text
 * that came from somewhere else. Every route here is an async server component
 * that reads a database before it returns anything, so there is nothing to
 * render in a unit test. The gate that can exist is a static one over the
 * source, and it answers the question that matters: was this string ever given
 * to the catalogue.
 *
 * **The pile is empty** (P6-G22c). What was a debt counter is now a floor: the
 * exemption list is `[]`, so the first rule covers every route in the
 * application rather than the handful nobody had got to yet.
 *
 * **Two rules were added when it emptied.** Every key has a consumer, deferred
 * from P2-T10 and worth having: the first thing it found was
 * `shell.version.updateAvailable`, written for UIUX-PLAN §3's "one reload with
 * a clear message" and rendered by nothing since P2-T10. And every key the
 * source has, Bahasa Melayu has too, so a key added without a stub fails in
 * the change that added it.
 */

const appDir = fileURLToPath(new URL("../app", import.meta.url));

function everyTsx(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The build output is not source, and it is enormous.
      if (entry.name === ".next") {
        continue;
      }
      found.push(...everyTsx(path));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/** `app/admin/nudges/page.tsx`, the shape the exemption list is written in. */
const relative = (path: string): string =>
  `app/${path
    .slice(appDir.length + 1)
    .split(sep)
    .join("/")}`;

const exempt = new Set(UNLOCALISED_FILES);
const files = everyTsx(appDir).sort();
const EN_CATALOGUE = CATALOGUES.en;

describe("the detector", () => {
  test("sees text between tags, and not a class name or a route", () => {
    const source = `
      export const A = () => (
        <div className="flex gap-2" data-testid="thing">
          <a href="/goals/one">Open the goal</a>
        </div>
      );
    `;
    expect(findUnlocalisedStrings(source).map((one) => one.text)).toEqual([
      "Open the goal",
    ]);
  });

  test("sees the four attributes a person reads, and not the rest", () => {
    const source = `
      export const A = () => (
        <input
          placeholder="How we will win activation"
          aria-label="Search"
          name="title"
          id="edit-title"
        />
      );
    `;
    expect(
      findUnlocalisedStrings(source)
        .map((one) => one.where)
        .sort(),
    ).toEqual(["aria-label", "placeholder"]);
  });

  test("passes a string that came from the catalogue", () => {
    // `{t("…")}` is a JSX expression rather than a string literal, so it is
    // excluded by the shape of the check rather than by a special case.
    const source = `
      export const A = () => <span aria-label={t("shell.search.label")}>{t("shell.search.label")}</span>;
    `;
    expect(findUnlocalisedStrings(source)).toEqual([]);
  });

  test("ignores punctuation, digits and separators", () => {
    // A reader sees these, and there is nothing to translate in them.
    const source = `
      export const A = () => (
        <span>
          <b>{count}</b> · {percent}% — <i>{name}</i>
        </span>
      );
    `;
    expect(findUnlocalisedStrings(source)).toEqual([]);
  });
});

describe("the catalogue gate", () => {
  test("no file outside the exemption list hardcodes a string", () => {
    const offenders = files
      .filter((path) => !exempt.has(relative(path)))
      .flatMap((path) =>
        findUnlocalisedIn(path).map(
          (one) => `${relative(path)}:${one.line} ${JSON.stringify(one.text)}`,
        ),
      );
    // A new screen puts its strings in the catalogue. An old one is on the
    // list below until P6-G22c reaches it.
    expect(offenders).toEqual([]);
  });

  test("every exemption names a file that exists", () => {
    // A rename that left its exemption behind would silently exempt nothing
    // and hide the next string added to the renamed file.
    const gone = UNLOCALISED_FILES.filter(
      (name) => !existsSync(join(appDir, "..", name)),
    );
    expect(gone).toEqual([]);
  });

  test("no exemption outlives the work it excused", () => {
    // This is what makes the list shrink by itself: clean a file's strings and
    // this fails until its line is deleted.
    const clean = UNLOCALISED_FILES.filter(
      (name) => findUnlocalisedIn(join(appDir, "..", name)).length === 0,
    );
    expect(clean).toEqual([]);
  });

  test("the debt is zero, and the list that held it is empty", () => {
    // 146 files and 1,543 strings at P6-G22b, all of them in the catalogue at
    // P6-G22c. The counter stays so that a re-exempted file has to raise a
    // number somebody set to nothing on purpose.
    const total = UNLOCALISED_FILES.reduce(
      (sum, name) => sum + findUnlocalisedIn(join(appDir, "..", name)).length,
      0,
    );
    expect(UNLOCALISED_FILES).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("the catalogue itself", () => {
  /**
   * Every place a key can be read from: the routes, the shared library beside
   * them, and the components in `packages/ui` that own the shell's own keys.
   */
  const consumerRoots = [
    appDir,
    join(appDir, "..", "lib"),
    join(appDir, "..", "..", "..", "packages", "ui", "src"),
  ];

  function everySource(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".next" || entry.name === "node_modules") {
          continue;
        }
        found.push(...everySource(path));
      } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        found.push(path);
      }
    }
    return found;
  }

  const sources = consumerRoots
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => everySource(dir))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  test("every key has a consumer", () => {
    // Deferred from P2-T10 to here, in the module's own words: "a key with no
    // consumer is a translation somebody pays for and nobody sees". Four keys
    // were deleted on 7 September 2026 for exactly that, found by reading
    // rather than by a test. This is the test.
    const orphans = Object.keys(EN_CATALOGUE).filter(
      (key) => !sources.includes(`"${key}"`),
    );
    expect(orphans).toEqual([]);
  });

  test("every key the source has, Bahasa Melayu has too", () => {
    // `missingKeys` in packages/ui says the same thing about the catalogues as
    // data. This says it about the catalogues this application actually ships,
    // so a key added here without a stub fails in the change that added it
    // rather than in somebody else's.
    expect(missingKeys("ms")).toEqual([]);
  });
});
