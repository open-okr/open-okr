import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Finding user-facing text that never passed through the catalogue
 * (UIUX-PLAN §8, P6-G22b).
 *
 * **A parser, not a regular expression.** The thing being looked for is a
 * string in a position a reader sees, and that is a question about the syntax
 * tree: the same characters are a class name, a route, a test id or a sentence
 * depending on where they sit. A regular expression over the file cannot tell
 * those apart and would either miss most of them or flag every `className`.
 *
 * **Two positions count.** Text between tags, which is the body of a screen,
 * and the four attributes whose value a person reads: `placeholder`,
 * `aria-label`, `title` and `alt`. An attribute written as `{t("…")}` is a
 * JSX expression rather than a string literal, so it is excluded by the shape
 * of the check rather than by a special case.
 *
 * Kept out of the test file so the detector can be exercised on strings of its
 * own rather than only on the repository, which is what makes it testable.
 */

/** The attributes whose value is read by a person rather than a machine. */
const READABLE_ATTRIBUTES = new Set([
  "placeholder",
  "aria-label",
  "title",
  "alt",
]);

/**
 * Text a reader would not recognise as a sentence.
 *
 * Punctuation, a lone digit, an ellipsis. Requiring two letters in a row is
 * enough: it passes "OK" and rejects "·", "—" and "0%". A single word is still
 * text a reader sees, so no length floor beyond that.
 */
const looksLikeProse = (value: string): boolean => /\p{L}\p{L}/u.test(value);

export interface UnlocalisedString {
  readonly line: number;
  readonly text: string;
  readonly where: "text" | string;
}

export function findUnlocalisedStrings(
  source: string,
  fileName = "file.tsx",
): readonly UnlocalisedString[] {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: UnlocalisedString[] = [];

  const lineOf = (node: ts.Node): number =>
    tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (looksLikeProse(text)) {
        found.push({ line: lineOf(node), text, where: "text" });
      }
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const initialiser = node.initializer;
      if (
        READABLE_ATTRIBUTES.has(name) &&
        initialiser !== undefined &&
        ts.isStringLiteral(initialiser) &&
        looksLikeProse(initialiser.text)
      ) {
        found.push({
          line: lineOf(node),
          text: initialiser.text,
          where: name,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(tree);
  return found;
}

export function findUnlocalisedIn(path: string): readonly UnlocalisedString[] {
  return findUnlocalisedStrings(readFileSync(path, "utf8"), path);
}
