/**
 * Require logical CSS properties in the web and shared UI sources
 * (docs/design/languages.md §9). The debt list records the existing sites.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript5";

export interface DirectionDebtEntry {
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
  /** Lets an existing site keep its exemption when unrelated lines move. */
  readonly context?: string;
}

const PHYSICAL_CLASS =
  /(?:^|[\s:!])(-?(?:(?:[mp][lr]|left|right|translate-x|space-x|scroll-[mp][lr]|inset-x)(?:-[^\s]+)|text-(?:left|right)|(?:border-[lr]|rounded-(?:[lr]|[tb][lr]))(?:-[^\s]+)?|(?:float|clear|bg)-(?:left|right)(?:-[^\s]+)?|bg-position-\[(?:left|right)_[^\s]+))(?=\s|$)/g;
const STYLE_SIDE =
  /^(?:left|right|(?:margin|padding|border|scrollMargin|scrollPadding)(?:Left|Right)(?:Color|Style|Width)?|border(?:Top|Bottom)(?:Left|Right)Radius)$/;
const STYLE_VALUE = /^(?:textAlign|float|clear|backgroundPosition)$/;
const PHYSICAL_WORD = /\b(?:left|right)\b/;
const CSS_SIDE =
  /(?:^|[\s;{])((?:left|right|(?:margin|padding|border|scroll-margin|scroll-padding)-(?:left|right)(?:-(?:color|style|width))?|border-(?:top|bottom)-(?:left|right)-radius))\s*:/g;
const CSS_VALUE =
  /(?:^|[\s;{])((?:text-align|float|clear|background-position)\s*:\s*[^;{}]*\b(?:left|right)\b|transform\s*:\s*[^;{}]*\btranslateX\([^)]*\))/g;
const NEUTRAL_COMMENT = /(?:\/\/|\/\*)\s*direction-neutral:\s*\S/;

function isInlineStyle(
  node: ts.Node,
  referencedStyles: ReadonlySet<string>,
): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) {
      return parent.name.getText() === "style";
    }
    if (
      ts.isAsExpression(parent) &&
      parent.type.getText() === "CSSProperties"
    ) {
      return true;
    }
    if (ts.isVariableDeclaration(parent)) {
      return (
        referencedStyles.has(parent.name.getText()) ||
        /\bCSSProperties\b/.test(parent.type?.getText() ?? "")
      );
    }
  }
  return false;
}

function findDirectionSites(
  file: string,
  source: string,
): DirectionDebtEntry[] {
  const sites: DirectionDebtEntry[] = [];
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const lines = source.split(/\r?\n/);
  const add = (offset: number, pattern: string) => {
    const { line } = parsed.getLineAndCharacterOfPosition(offset);
    const context = lines[line]?.trim() ?? "";
    if (
      NEUTRAL_COMMENT.test(context) ||
      NEUTRAL_COMMENT.test(lines[line - 1] ?? "")
    ) {
      return;
    }
    sites.push({ file, line: line + 1, pattern, context });
  };

  if (file.endsWith(".css")) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\r\n]/g, " "),
    );
    for (const pattern of [CSS_SIDE, CSS_VALUE]) {
      for (const match of code.matchAll(pattern)) {
        const name = match[1] ?? "";
        add(match.index + match[0].indexOf(name), name.trim());
      }
    }
    return sites;
  }

  const referencedStyles = new Set<string>();
  function recordStyleReferences(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "style") {
      const expression =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined;
      if (expression && ts.isIdentifier(expression)) {
        referencedStyles.add(expression.text);
      }
      if (expression && ts.isObjectLiteralExpression(expression)) {
        for (const property of expression.properties) {
          if (
            ts.isSpreadAssignment(property) &&
            ts.isIdentifier(property.expression)
          ) {
            referencedStyles.add(property.expression.text);
          }
        }
      }
    }
    ts.forEachChild(node, recordStyleReferences);
  }

  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const end =
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? -2 : -1;
      const text = node.getText(parsed).slice(1, end);
      for (const match of text.matchAll(PHYSICAL_CLASS)) {
        const utility = match[1] ?? "";
        add(
          node.getStart(parsed) + 1 + match.index + match[0].indexOf(utility),
          utility,
        );
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      isInlineStyle(node, referencedStyles)
    ) {
      const name = node.name.getText(parsed).replace(/^["']|["']$/g, "");
      const value = node.initializer.getText(parsed);
      if (
        STYLE_SIDE.test(name) ||
        (STYLE_VALUE.test(name) && PHYSICAL_WORD.test(value)) ||
        (name === "transform" && /\btranslateX\(/.test(value))
      ) {
        add(node.name.getStart(parsed), name);
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "style" &&
      STYLE_SIDE.test(node.name.text)
    ) {
      add(node.name.getStart(parsed), node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  recordStyleReferences(parsed);
  visit(parsed);
  return sites;
}

export function checkDirectionCode(
  file: string,
  source: string,
  debt: readonly DirectionDebtEntry[],
): DirectionDebtEntry[] {
  const remaining = debt.filter((entry) => entry.file === file);
  return findDirectionSites(file, source).filter((site) => {
    const match = remaining.findIndex(
      (entry) =>
        entry.pattern === site.pattern &&
        (entry.context === undefined
          ? entry.line === site.line
          : entry.context === site.context),
    );
    if (match === -1) {
      return true;
    }
    remaining.splice(match, 1);
    return false;
  });
}

function main(): void {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const debtPath = join(root, "scripts/direction-debt.json");
  const debt: DirectionDebtEntry[] = JSON.parse(readFileSync(debtPath, "utf8"));
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps/web",
      "packages/ui/src",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (file) =>
        /\.(?:[cm]?[jt]sx?|css)$/.test(file) &&
        !/(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^.]+$|\.d\.ts$/.test(
          file,
        ) &&
        existsSync(join(root, file)),
    );
  const violations = files.flatMap((file) =>
    checkDirectionCode(file, readFileSync(join(root, file), "utf8"), debt),
  );
  if (violations.length) {
    for (const { file, line, pattern } of violations) {
      console.error(
        `${file}:${line}: use a logical property instead of ${pattern}`,
      );
    }
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main();
}
