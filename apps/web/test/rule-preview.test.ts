import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * A link to a rule's page previews the rule (UIUX-PLAN §4, method hint).
 *
 * Read as source, because what is worth protecting is that no screen links to
 * a rule bare: a verdict or a nudge that names "KR-3" and links to it without
 * the preview is the reader opening the rule to find out what it asks.
 */

const appDir = fileURLToPath(new URL("../app", import.meta.url));
const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

function everyTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === ".next" ? [] : everyTsx(path);
    }
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * The one screen allowed a bare link: the Cycle screen's verdict panel, which
 * already shows the rule's prompt, the case that matched and its weak and
 * strong example before its "see the rule" link.
 */
const EXPLAINED_IN_FULL = new Set(["cycle/rule-verdict.tsx"]);

describe("links to a rule", () => {
  test("go through the preview, wherever a screen names a rule", () => {
    const bare = everyTsx(appDir)
      .filter((file) => !EXPLAINED_IN_FULL.has(relative(appDir, file)))
      .filter((file) => readFileSync(file, "utf8").includes("/method/${"))
      .map((file) => relative(appDir, file));
    expect(bare).toEqual([]);
  });

  test("are previewed from the catalogue, never from a screen's own words", () => {
    const preview = at("../lib/rule-preview.tsx");
    expect(preview).toContain("describeRule(ruleKey)");
    // A key the catalogue does not know is still a link, never a dead end.
    expect(preview).toContain("if (rule === null)");
  });

  test("a check's own page links to its METHOD.md section", () => {
    const rulePage = at("../app/method/[id]/page.tsx");
    expect(rulePage).toContain("methodSectionAnchor(checkSection(check.id))");
  });
});
