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
 * Every file whose count differs from the baseline, either way.
 *
 * More than the baseline is a field drawn without the kit. Fewer is progress
 * the baseline has not recorded yet, and is refused until it does, which is
 * what makes this a ratchet rather than a ceiling.
 */
export function compareRawFields(
  counts: ReadonlyMap<string, number>,
  baseline: Readonly<Record<string, number>>,
): RawFieldFinding[] {
  const findings: RawFieldFinding[] = [];
  const paths = new Set([...counts.keys(), ...Object.keys(baseline)]);
  for (const path of [...paths].sort()) {
    const now = counts.get(path) ?? 0;
    const allowed = baseline[path] ?? 0;
    if (now > allowed) {
      findings.push({
        path,
        message:
          `draws ${now} raw field(s) where the baseline allows ${allowed}. ` +
          "Use the field kit in packages/ui (docs/design/guided-inputs.md §4).",
      });
    } else if (now < allowed) {
      findings.push({
        path,
        message:
          `draws ${now} raw field(s), fewer than the baseline's ${allowed}. ` +
          "Lower its entry so the gain holds: pnpm check:boundaries --update-field-baseline.",
      });
    }
  }
  return findings;
}
