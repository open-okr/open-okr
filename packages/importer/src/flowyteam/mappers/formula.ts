/**
 * FlowyTeam's calculated-KPI tokens into this product's expression tree
 * (TECHNICAL-PLAN §7.2, P6-T03d).
 *
 * **The source stores a formula as a comma-separated token list and evaluates
 * it with `eval()`.** A live instance holds 26248 of them, and they look like
 * this:
 *
 *     kpi_51,op_divide,kpi_50
 *     op_open,kpi_54,op_minus,kpi_53,op_close,op_divide,op_open,kpi_77,op_close,op_multiply,100
 *
 * This product stores a tree instead, which is what makes a formula something
 * the engine can validate, bound and walk for cycles rather than a string it
 * has to trust. So the tokens are parsed here, with the ordinary precedence
 * `eval()` would have applied: multiplication and division bind tighter than
 * addition and subtraction, and parentheses win over both.
 *
 * **Anything that will not parse is dropped and logged, never guessed at.** A
 * formula this cannot read is one the old system may have evaluated to
 * something surprising anyway, and a KPI carrying a wrong calculation is worse
 * than one carrying none: the number would look authoritative and be wrong.
 * The KPI itself still imports, with its recorded values.
 *
 * Pure, and its own module, because a parser is the part of an importer most
 * worth testing on its own: every case here is a string, and none of them needs
 * a database to prove.
 */

/** The tree this product stores. Mirrors `FormulaNode` in `packages/method`. */
export type ParsedFormula =
  | { readonly n: number }
  | { readonly k: string }
  | {
      readonly op: "add" | "sub" | "mul" | "div";
      readonly l: ParsedFormula;
      readonly r: ParsedFormula;
    };

export type FormulaParse =
  | {
      readonly ok: true;
      readonly tree: ParsedFormula;
      /** The source KPI ids the tree references, in the order they appear. */
      readonly references: readonly number[];
    }
  | { readonly ok: false; readonly reason: string };

const BINARY = {
  op_plus: "add",
  op_minus: "sub",
  op_multiply: "mul",
  op_divide: "div",
} as const;

type Token =
  | { kind: "number"; value: number }
  | { kind: "kpi"; id: number }
  | { kind: "op"; op: "add" | "sub" | "mul" | "div" }
  | { kind: "open" }
  | { kind: "close" };

/**
 * The token list, or a refusal naming the token that stopped it.
 *
 * Unknown tokens are the interesting case: FlowyTeam's own editor writes a few
 * this list does not have, and naming the one that failed is what lets somebody
 * decide whether it matters.
 */
function tokenise(text: string): Token[] | string {
  const tokens: Token[] = [];
  for (const raw of text.split(",")) {
    const piece = raw.trim();
    if (piece === "") {
      continue;
    }
    if (piece === "op_open") {
      tokens.push({ kind: "open" });
      continue;
    }
    if (piece === "op_close") {
      tokens.push({ kind: "close" });
      continue;
    }
    const binary = BINARY[piece as keyof typeof BINARY];
    if (binary) {
      tokens.push({ kind: "op", op: binary });
      continue;
    }
    const kpi = /^kpi_(\d+)$/.exec(piece);
    if (kpi?.[1]) {
      tokens.push({ kind: "kpi", id: Number(kpi[1]) });
      continue;
    }
    const number = Number(piece);
    if (piece !== "" && Number.isFinite(number)) {
      tokens.push({ kind: "number", value: number });
      continue;
    }
    return `it contains "${piece}", which is not a KPI, a number or one of the four operators`;
  }
  return tokens;
}

export function parseFormulaTokens(text: string): FormulaParse {
  const tokens = tokenise(text);
  if (typeof tokens === "string") {
    return { ok: false, reason: tokens };
  }
  if (tokens.length === 0) {
    return { ok: false, reason: "it is empty" };
  }

  let at = 0;
  const references: number[] = [];

  const peek = (): Token | undefined => tokens[at];

  /** A number, a KPI, or a parenthesised expression. */
  const atom = (): ParsedFormula | string => {
    const token = peek();
    if (!token) {
      return "it ends where a value should be";
    }
    at += 1;
    if (token.kind === "number") {
      return { n: token.value };
    }
    if (token.kind === "kpi") {
      references.push(token.id);
      return { k: String(token.id) };
    }
    if (token.kind === "open") {
      const inner = expression();
      if (typeof inner === "string") {
        return inner;
      }
      const next = peek();
      if (next?.kind !== "close") {
        return "a bracket is opened and never closed";
      }
      at += 1;
      return inner;
    }
    return "it has an operator where a value should be";
  };

  /** Multiplication and division, which bind tighter. */
  const product = (): ParsedFormula | string => {
    let left = atom();
    if (typeof left === "string") {
      return left;
    }
    for (;;) {
      const token = peek();
      if (token?.kind !== "op" || (token.op !== "mul" && token.op !== "div")) {
        return left;
      }
      at += 1;
      const right = atom();
      if (typeof right === "string") {
        return right;
      }
      left = { op: token.op, l: left, r: right };
    }
  };

  const expression = (): ParsedFormula | string => {
    let left = product();
    if (typeof left === "string") {
      return left;
    }
    for (;;) {
      const token = peek();
      if (token?.kind !== "op" || (token.op !== "add" && token.op !== "sub")) {
        return left;
      }
      at += 1;
      const right = product();
      if (typeof right === "string") {
        return right;
      }
      left = { op: token.op, l: left, r: right };
    }
  };

  const tree = expression();
  if (typeof tree === "string") {
    return { ok: false, reason: tree };
  }
  if (at !== tokens.length) {
    return {
      ok: false,
      reason: "it has something left over after the expression ends",
    };
  }
  if (references.length === 0) {
    // A formula of pure arithmetic references no KPI and would produce the same
    // number every period, which is a target rather than a calculation.
    return { ok: false, reason: "it references no other KPI" };
  }
  return { ok: true, tree, references };
}

/**
 * The same tree with every source id replaced by the target's own.
 *
 * Returns the ids it could not resolve rather than throwing, so the caller can
 * say which KPI the formula pointed at and did not import.
 */
export function resolveFormulaReferences(
  tree: ParsedFormula,
  targets: ReadonlyMap<number, string>,
): { ok: true; tree: ParsedFormula } | { ok: false; missing: number[] } {
  const missing: number[] = [];

  const walk = (node: ParsedFormula): ParsedFormula => {
    if ("n" in node) {
      return node;
    }
    if ("k" in node) {
      const target = targets.get(Number(node.k));
      if (!target) {
        missing.push(Number(node.k));
        return node;
      }
      return { k: target };
    }
    return { op: node.op, l: walk(node.l), r: walk(node.r) };
  };

  const resolved = walk(tree);
  return missing.length > 0
    ? { ok: false, missing }
    : { ok: true, tree: resolved };
}
