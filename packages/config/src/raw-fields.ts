import ts from "typescript5";

/**
 * The raw-field ratchet (docs/design/guided-inputs.md §6).
 *
 * A screen in `apps/web` that draws its own `<input>`, `<textarea>` or
 * `<select>` skips the field kit: no linked label, description and error, no
 * format check shared with the server, and another copy of a skin there were
 * ninety-nine of. The kit replaces them screen by screen, and this is what
 * stops a new one arriving behind the migration: each file may hold as many as
 * the committed baseline says and no more. A file that drops below its entry
 * has to lower the entry, so the gain cannot be spent again later.
 *
 * **The syntax tree, not a pattern.** A pattern over the text counted
 * `<input>` written in a comment and missed real tags around an arrow
 * function, so a changed comment could fail the gate. The parser is
 * TypeScript 5, the version the repository keeps for walking a syntax tree,
 * and this module is read by the boundary script only, never at runtime.
 */

/** Input types that are not a field somebody types or picks a value into. */
const NOT_A_FIELD = new Set([
  "hidden",
  "checkbox",
  "radio",
  "file",
  "submit",
  "button",
  "reset",
  "image",
]);

/** The literal `type` of an `<input>`, or null when it has none or it is computed. */
function literalType(
  attributes: ts.JsxAttributes,
  source: ts.SourceFile,
): string | null {
  for (const property of attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      property.name.getText(source) !== "type"
    ) {
      continue;
    }
    const value = property.initializer;
    if (value && ts.isStringLiteral(value)) {
      return value.text;
    }
    if (
      value &&
      ts.isJsxExpression(value) &&
      value.expression &&
      ts.isStringLiteral(value.expression)
    ) {
      return value.expression.text;
    }
    return null;
  }
  return null;
}

/**
 * How many raw fields a source file draws: every `<textarea>` and `<select>`,
 * and every `<input>` except the kinds that are not a typed or picked value.
 * An input whose type is computed counts, because it is a field either way.
 */
export function countRawFields(text: string, path = "screen.tsx"): number {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === "textarea" || tag === "select") {
        count += 1;
      } else if (tag === "input") {
        const type = literalType(node.attributes, source);
        if (type === null || !NOT_A_FIELD.has(type.toLowerCase())) {
          count += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

export interface RawFieldFinding {
  readonly path: string;
  readonly message: string;
}

/**
 * Every screen file that draws a raw field (guided-inputs §6, as of 10d).
 *
 * It was a ratchet: each file could draw as many as a baseline allowed, and
 * the baseline only went down, from 336 fields to none across change 10.
 * With none left there is nothing to hold, so the rule is the plain one: a
 * screen draws its fields with the kit.
 */
export function rawFieldFindings(
  counts: ReadonlyMap<string, number>,
): RawFieldFinding[] {
  return [...counts]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, count]) => ({
      path,
      message:
        `draws ${count} raw field(s). ` +
        "Use the field kit in packages/ui (docs/design/guided-inputs.md §4).",
    }));
}
