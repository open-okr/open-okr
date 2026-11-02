import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// TypeScript 7 no longer exports the compiler API this walks.
import ts from "typescript5";
import { describe, expect, test } from "vitest";

/**
 * Nobody reading the product sees a section sign.
 *
 * A "§2.9" points into the specification, which is where the product was
 * built from and not something a person using it has open. On a screen, in an
 * error, in the API reference or in an agent's tool list it reads as a
 * leftover. The specification and code comments keep their section numbers,
 * because the people reading those do have the document open.
 *
 * **A parser, not a regular expression.** The sign is fine in a comment and
 * wrong in a string, and only the syntax tree can tell the two apart.
 */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** Every source tree whose strings can reach a person. */
const ROOTS = [
  "apps/web/app",
  "apps/web/lib",
  "packages/ui/src",
  "packages/method/src",
  "packages/core/src",
  "packages/agents/src",
  "packages/adapters/src",
  "packages/importer/src",
  "packages/db/src/data-changes",
];

const CATALOGUES = [
  "packages/ui/src/i18n/messages/en.json",
  "packages/ui/src/i18n/messages/ms.json",
];

const DASHBOARDS = "deploy/docker/observability/dashboards";

/**
 * What an API client, an agent or an operator reads instead of a screen. The
 * contract is generated from the registry's descriptions, so it is read whole.
 */
const ARTIFACTS = [
  "contract/openapi.json",
  "contract/cli.json",
  "contract/mcp.json",
  ...readdirSync(join(REPO, DASHBOARDS))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `${DASHBOARDS}/${name}`),
];

/** A section sign, or a screen code such as "S-27" from the specification. */
const SPECIFICATION_REFERENCE = /§[\d.]*|\bS-\d{2}[a-z]?\b/g;

const STRING_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

export function signsInStrings(
  source: string,
  fileName = "file.ts",
): readonly number[] {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (STRING_KINDS.has(node.kind)) {
      // A query's own `--` comments go to the database, not to a person.
      const text = node.getText(tree).replace(/--[^\n]*/g, "");
      if (text.includes("§")) {
        lines.push(
          tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return lines;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "test"].includes(entry.name)) {
        continue;
      }
      found.push(...sourceFiles(path));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

describe("the detector", () => {
  test("sees the sign in a string, a template and between tags", () => {
    const source = [
      'const a = "as §2.9 says";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text holding a template literal, parsed rather than run.
      "const b = `${n} rows, §4.5`;",
      "const C = () => <p>See §8</p>;",
    ].join("\n");
    expect(signsInStrings(source, "a.tsx")).toEqual([1, 2, 3]);
  });

  test("leaves comments and a query's own comments alone", () => {
    const source = [
      "// METHOD.md §2.9",
      "/** The gate (§4.5). */",
      "const q = sql`select 1 -- §4.1 composes two grants\n`;",
      "const C = () => <p>{/* §8.1 */}Ready</p>;",
    ].join("\n");
    expect(signsInStrings(source, "a.tsx")).toEqual([]);
  });
});

describe("the product", () => {
  test("puts no section sign in a string a person can read", () => {
    const offenders = ROOTS.flatMap((root) =>
      sourceFiles(join(REPO, root)).flatMap((path) =>
        signsInStrings(readFileSync(path, "utf8"), path).map(
          (line) => `${relative(REPO, path).split(sep).join("/")}:${line}`,
        ),
      ),
    );
    expect(offenders).toEqual([]);
  });

  test("puts no section sign in either catalogue", () => {
    for (const file of CATALOGUES) {
      const messages = JSON.parse(
        readFileSync(join(REPO, file), "utf8"),
      ) as Record<string, string>;
      const offenders = Object.entries(messages)
        .filter(([, text]) => text.includes("§"))
        .map(([key]) => key);
      expect(offenders, file).toEqual([]);
    }
  });

  test("names neither a section nor a screen in the API or the dashboards", () => {
    for (const file of ARTIFACTS) {
      const text = readFileSync(join(REPO, file), "utf8");
      expect(text.match(SPECIFICATION_REFERENCE) ?? [], file).toEqual([]);
    }
  });
});
