/**
 * The calculated-KPI formula engine (METHOD.md §6, design
 * `p3-t00-kpi-engine.md` §5 to §7, P3-T13).
 *
 * **A typed expression tree, validated with Zod. No string parsing at evaluation
 * time and no dynamic evaluation, ever.** A formula arrives from the interface's
 * builder as a tree and is stored as one; there is no second representation for
 * the two to disagree about, and nothing here can be talked into running code.
 *
 * Parentheses do not exist as syntax, because a tree already carries precedence.
 *
 * Pure, like the rest of `packages/method`: the caller resolves every reference
 * to a number or a null and passes them in.
 */
import { z } from "zod";

/**
 * Evaluation safety bounds, deliberately not §11 parameters.
 *
 * §11 holds the numbers the practice fires on. These are limits on an evaluator,
 * and a workspace has no business raising them: a deeper tree is not a different
 * management style, it is a formula nobody can read.
 */
export const FORMULA_MAX_DEPTH = 32;
export const FORMULA_MAX_NODES = 256;
export const FORMULA_MAX_REFERENCES = 32;

export type FormulaNode =
  | { readonly n: number }
  | { readonly k: string }
  | {
      readonly op: "add" | "sub" | "mul" | "div";
      readonly l: FormulaNode;
      readonly r: FormulaNode;
    }
  | { readonly neg: FormulaNode };

/**
 * The stored shape. Recursive, so the schema is declared lazily and the depth,
 * node and reference limits are checked afterwards by `validateFormula`: a Zod
 * refinement cannot see the whole tree from inside one node.
 */
export const formulaNodeSchema: z.ZodType<FormulaNode> = z.lazy(() =>
  z.union([
    z.object({ n: z.number().finite() }).strict(),
    z.object({ k: z.string().min(1) }).strict(),
    z
      .object({
        op: z.enum(["add", "sub", "mul", "div"]),
        l: formulaNodeSchema,
        r: formulaNodeSchema,
      })
      .strict(),
    z.object({ neg: formulaNodeSchema }).strict(),
  ]),
);

export type FormulaProblem =
  | "too_deep"
  | "too_many_nodes"
  | "too_many_references"
  | "not_a_formula";

export interface FormulaShape {
  readonly ok: boolean;
  readonly problem: FormulaProblem | null;
  readonly depth: number;
  readonly nodes: number;
  /** Distinct referenced KPI identifiers, in first-seen order. */
  readonly references: readonly string[];
}

/**
 * Measures the raw shape before Zod sees it, iteratively.
 *
 * **This exists because `safeParse` recurses.** The schema is lazy and
 * self-referential, so parsing a tree deeper than the call stack throws a
 * `RangeError` rather than returning a failure, and a formula arriving from an
 * import or a hostile client would take the process down. My own test caught
 * that: the measurement below was already iterative, and the parse in front of it
 * was not. So the depth bound is checked here first, on plain objects, and only a
 * tree that could not blow the stack is handed to Zod.
 */
function rawDepthExceedsBound(value: unknown): boolean {
  let deepest = 0;
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  let visited = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    visited += 1;
    // A tree past both bounds is refused without walking the rest of it: the
    // answer cannot change, and a hostile payload should not buy unbounded work.
    if (visited > FORMULA_MAX_NODES * 2) {
      return true;
    }
    deepest = Math.max(deepest, entry.depth);
    if (deepest > FORMULA_MAX_DEPTH) {
      return true;
    }
    const node = entry.node;
    if (typeof node !== "object" || node === null) {
      continue;
    }
    const record = node as Record<string, unknown>;
    for (const key of ["l", "r", "neg"]) {
      if (key in record) {
        stack.push({ node: record[key], depth: entry.depth + 1 });
      }
    }
  }
  return false;
}

/** Parses and measures a stored formula against the safety bounds. */
export function validateFormula(value: unknown): FormulaShape {
  if (rawDepthExceedsBound(value)) {
    return {
      ok: false,
      problem: "too_deep",
      depth: FORMULA_MAX_DEPTH + 1,
      nodes: 0,
      references: [],
    };
  }

  const parsed = formulaNodeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      problem: "not_a_formula",
      depth: 0,
      nodes: 0,
      references: [],
    };
  }

  let nodes = 0;
  let deepest = 0;
  const references: string[] = [];
  const seen = new Set<string>();

  // Iterative for the same reason the pre-check above is, and the same reason
  // the scoring cascade's second pass is (P3-T05): a thousand-deep chain of
  // recursive frames is somebody's outage.
  const stack: { node: FormulaNode; depth: number }[] = [
    { node: parsed.data, depth: 1 },
  ];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    nodes += 1;
    deepest = Math.max(deepest, entry.depth);
    const node = entry.node;
    if ("k" in node) {
      if (!seen.has(node.k)) {
        seen.add(node.k);
        references.push(node.k);
      }
    } else if ("op" in node) {
      stack.push({ node: node.l, depth: entry.depth + 1 });
      stack.push({ node: node.r, depth: entry.depth + 1 });
    } else if ("neg" in node) {
      stack.push({ node: node.neg, depth: entry.depth + 1 });
    }
  }

  const problem: FormulaProblem | null =
    deepest > FORMULA_MAX_DEPTH
      ? "too_deep"
      : nodes > FORMULA_MAX_NODES
        ? "too_many_nodes"
        : references.length > FORMULA_MAX_REFERENCES
          ? "too_many_references"
          : null;

  return {
    ok: problem === null,
    problem,
    depth: deepest,
    nodes,
    references,
  };
}

export type FormulaDiagnostic = "missing_source" | "divide_by_zero";

export interface FormulaResult {
  /** Null whenever a diagnostic is set. Never a fabricated number. */
  readonly value: number | null;
  readonly diagnostic: FormulaDiagnostic | null;
  /** The reference that was missing, when that is the diagnostic. */
  readonly missing: string | null;
}

/**
 * Evaluates a validated tree against resolved source values (design §5).
 *
 * Three rules, and each exists because the alternative reports a lie:
 *
 * - **Null propagates.** Any null operand makes the whole expression null with a
 *   `missing_source` diagnostic naming the reference. `0 × null` is null, not 0:
 *   short-circuiting would be arithmetically defensible and reporting-wise wrong,
 *   because the number would look measured when nothing was measured.
 * - **Division by zero is null**, with its own diagnostic. Never 0, which would
 *   read as a real `unhealthy` (decision D-9).
 * - **A null result writes no actual value**, so the dependent KPI reads
 *   `no_data` rather than carrying a fabricated number. That is the caller's
 *   half, and `value === null` is how this function says so.
 */
export function evaluateFormula(
  node: FormulaNode,
  sources: Readonly<Record<string, number | null | undefined>>,
): FormulaResult {
  const missing = (reference: string): FormulaResult => ({
    value: null,
    diagnostic: "missing_source",
    missing: reference,
  });
  const dividedByZero: FormulaResult = {
    value: null,
    diagnostic: "divide_by_zero",
    missing: null,
  };

  const walk = (current: FormulaNode): FormulaResult => {
    if ("n" in current) {
      return { value: current.n, diagnostic: null, missing: null };
    }
    if ("k" in current) {
      const resolved = sources[current.k];
      return resolved === null || resolved === undefined
        ? missing(current.k)
        : { value: resolved, diagnostic: null, missing: null };
    }
    if ("neg" in current) {
      const inner = walk(current.neg);
      return inner.value === null
        ? inner
        : { value: -inner.value, diagnostic: null, missing: null };
    }

    const left = walk(current.l);
    // Left first, so a formula with two problems names the one a reader meets
    // first reading left to right.
    if (left.value === null) {
      return left;
    }
    const right = walk(current.r);
    if (right.value === null) {
      return right;
    }
    switch (current.op) {
      case "add":
        return {
          value: left.value + right.value,
          diagnostic: null,
          missing: null,
        };
      case "sub":
        return {
          value: left.value - right.value,
          diagnostic: null,
          missing: null,
        };
      case "mul":
        return {
          value: left.value * right.value,
          diagnostic: null,
          missing: null,
        };
      case "div":
        return right.value === 0
          ? dividedByZero
          : {
              value: left.value / right.value,
              diagnostic: null,
              missing: null,
            };
    }
  };

  const result = walk(node);
  return result.value === null
    ? result
    : {
        // Two decimals, the same rounding the achievement ratio uses, so a
        // calculated KPI and a recorded one are comparable on sight.
        value: Math.round(result.value * 100) / 100,
        diagnostic: null,
        missing: null,
      };
}
