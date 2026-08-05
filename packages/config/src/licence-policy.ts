/**
 * SPDX licence expression evaluation for the dependency licence gate.
 *
 * A dependency's licence field is not always a single identifier. SPDX allows
 * expressions, and the two operators mean opposite things for us:
 *
 *   `MIT OR CC0-1.0`      we may choose either, so one allowed operand is enough
 *   `MIT AND CC-BY-4.0`   both apply at once, so every operand must be allowed
 *
 * Getting this wrong in either direction is expensive: treating OR as AND
 * blocks perfectly usable packages, and treating AND as OR ships a licence we
 * cannot distribute under AGPL-3.0. The allow list itself stays a human
 * decision; this only reads what the expression says.
 */

/** A parsed SPDX expression: a leaf identifier, or an operator over operands. */
type Expression =
  | { readonly kind: "identifier"; readonly id: string }
  | { readonly kind: "or" | "and"; readonly operands: readonly Expression[] };

/** Splits on a top-level operator, ignoring anything inside parentheses. */
const splitTopLevel = (text: string, operator: "OR" | "AND"): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    } else if (depth === 0) {
      // Match the operator only as a whole word at this nesting level.
      const candidate = text.slice(i, i + operator.length);
      const before = text[i - 1];
      const after = text[i + operator.length];
      if (
        candidate.toUpperCase() === operator &&
        (before === undefined || /\s/.test(before)) &&
        (after === undefined || /\s/.test(after))
      ) {
        parts.push(text.slice(start, i));
        i += operator.length - 1;
        start = i + 1;
      }
    }
  }

  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

const stripOuterParens = (text: string): string => {
  let result = text.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    // Only strip when the opening paren matches the closing one, so
    // "(MIT) AND (ISC)" is not mistaken for a parenthesised whole.
    let depth = 0;
    let matched = true;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === "(") {
        depth++;
      } else if (result[i] === ")") {
        depth--;
        if (depth === 0 && i < result.length - 1) {
          matched = false;
          break;
        }
      }
    }
    if (!matched) {
      break;
    }
    result = result.slice(1, -1).trim();
  }
  return result;
};

/** Parses an SPDX expression. Unknown syntax degrades to a single identifier,
 * which the caller then treats as unrecognised and reports. */
function parseLicenceExpression(expression: string): Expression {
  const text = stripOuterParens(expression);

  const orParts = splitTopLevel(text, "OR");
  if (orParts.length > 1) {
    return { kind: "or", operands: orParts.map(parseLicenceExpression) };
  }

  const andParts = splitTopLevel(text, "AND");
  if (andParts.length > 1) {
    return { kind: "and", operands: andParts.map(parseLicenceExpression) };
  }

  // A trailing "+" means "or later"; the allow list carries explicit
  // identifiers, so keep the raw form and let the allow list decide.
  return { kind: "identifier", id: stripOuterParens(text) };
}

/**
 * True when a dependency's licence field is acceptable under `allowed`.
 * `WITH` exception clauses are deliberately not understood: they are rare and
 * warrant a human reading the exception rather than a regular expression.
 */
export function isLicenceAllowed(
  expression: string,
  allowed: ReadonlySet<string>,
): boolean {
  const evaluate = (node: Expression): boolean => {
    if (node.kind === "identifier") {
      return allowed.has(node.id);
    }
    return node.kind === "or"
      ? node.operands.some(evaluate)
      : node.operands.every(evaluate);
  };

  if (/\bWITH\b/i.test(expression)) {
    return false;
  }

  return evaluate(parseLicenceExpression(expression));
}
