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

/** A catalogue key rendered where a translator cannot place it. */
export interface FragmentedMessage {
  readonly line: number;
  readonly key: string;
  /** The expression it was rendered next to, trimmed for the message. */
  readonly beside: string;
}

/**
 * Is this JSX child nothing a reader sees?
 *
 * Whitespace between elements, and `{" "}`, which is how the formatter keeps a
 * space the JSX would otherwise eat. Both sit between a message and a value
 * without separating them.
 */
function isInvisible(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) {
    return child.text.trim() === "";
  }
  if (ts.isJsxExpression(child) && child.expression !== undefined) {
    return (
      ts.isStringLiteral(child.expression) &&
      child.expression.text.trim() === ""
    );
  }
  return false;
}

/** The catalogue key this child renders, if it renders exactly one. */
function catalogueKeyOf(child: ts.JsxChild): string | null {
  if (!ts.isJsxExpression(child) || child.expression === undefined) {
    return null;
  }
  const call = child.expression;
  if (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "t" &&
    call.arguments.length >= 1
  ) {
    const first = call.arguments[0];
    return first !== undefined && ts.isStringLiteral(first) ? first.text : null;
  }
  return null;
}

/**
 * A message rendered immediately beside a value (P6-G22d).
 *
 * **This is the defect itself, rather than a proxy for it.** The codemod that
 * moved 1,543 strings into the catalogue could not keep a sentence whole when
 * an expression sat in the middle of it, so it cut the sentence at the
 * expression and made an entry of each piece. A translator handed "at" has no
 * way to know what it attaches to, and no way to move it: word order is not
 * the same in every language, and the pieces are fixed in English order by the
 * JSX around them.
 *
 * A message with a named hole has neither problem, so the rule is that a
 * catalogue key may not be rendered next to an interpolation. Whitespace and
 * `{" "}` between them do not separate them.
 *
 * **What this does not flag is a lowercase entry on its own.** "pending" and
 * "linked" are labels, and a label is translatable whatever case it starts in.
 * The plan's own wording for this check was "an entry whose English begins
 * mid-sentence", which would flag every one of those and miss a fragment that
 * happens to start with a capital, of which there are several: "Held back,
 * because" is one.
 */
export function findFragmentedMessages(
  source: string,
  fileName = "file.tsx",
): readonly FragmentedMessage[] {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: FragmentedMessage[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children.filter((child) => !isInvisible(child));
      for (let index = 0; index < children.length - 1; index++) {
        const left = children[index];
        const right = children[index + 1];
        if (left === undefined || right === undefined) {
          continue;
        }
        const leftKey = catalogueKeyOf(left);
        const rightKey = catalogueKeyOf(right);
        // One of the pair is a message and the other is a value. Two messages
        // side by side are fine, and so are two values.
        const pairs: ReadonlyArray<[string | null, ts.JsxChild]> = [
          [leftKey, right],
          [rightKey, left],
        ];
        for (const [key, other] of pairs) {
          if (
            key !== null &&
            ts.isJsxExpression(other) &&
            other.expression !== undefined &&
            catalogueKeyOf(other) === null
          ) {
            found.push({
              line:
                tree.getLineAndCharacterOfPosition(other.getStart(tree)).line +
                1,
              key,
              beside: other.getText(tree).replace(/\s+/g, " ").slice(0, 60),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return found;
}

export function findFragmentedIn(path: string): readonly FragmentedMessage[] {
  return findFragmentedMessages(readFileSync(path, "utf8"), path);
}

/**
 * Punctuation no sentence starts with.
 *
 * A value beginning with one of these is the tail of something: "· expires",
 * ", and", ". It will get a token". No language begins a message that way, and
 * unlike a lowercase label there is no reading of it that is a label.
 */
export function beginsMidSentence(value: string): boolean {
  return /^[.,;:)·%!?]/.test(value.trim());
}
