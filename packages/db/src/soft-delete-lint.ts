/**
 * The soft-delete usage lint.
 *
 * Finds drizzle reads, updates and deletes that target a soft-deletable
 * table without stating a scope — neither the `activeOnly` default nor the
 * `includeDeleted` opt-in — and reports them as build failures. Textual and
 * deliberately simple: it inspects the statement around each call site, and
 * scope helpers take the table as an argument precisely so this check stays
 * cheap and reliable.
 */

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface SoftDeleteViolation {
  readonly path: string;
  /** 1-based line of the offending call. */
  readonly line: number;
  readonly message: string;
}

/**
 * Reads drizzle schema sources and returns the exported `pgTable` constants
 * that carry a `deleted_at` column — the tables the lint watches.
 */
export function collectSoftDeletableTables(
  schemaSources: readonly string[],
): Set<string> {
  const tables = new Set<string>();
  for (const source of schemaSources) {
    const pattern = /export\s+const\s+(\w+)\s*=\s*pgTable\s*\(/g;
    for (const match of source.matchAll(pattern)) {
      const start = match.index + match[0].length;
      const body = balancedTo(source, start - 1);
      if (/["']deleted_at["']/.test(body)) {
        tables.add(match[1] as string);
      }
    }
  }
  return tables;
}

/** The text from the `(` at `open` to its matching `)`. */
const balancedTo = (text: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        return text.slice(open, i + 1);
      }
    }
  }
  return text.slice(open);
};

const SCOPE_TOKENS = ["activeOnly(", "includeDeleted(", "softDeleteRows("];

/**
 * Lints source files against the set of soft-deletable table names.
 * A `.from(table)`, `.update(table)` or `.delete(table)` whose surrounding
 * statement carries no scope token is a violation.
 */
export function lintSoftDeleteUsage(
  files: readonly SourceFile[],
  tables: ReadonlySet<string>,
): SoftDeleteViolation[] {
  const violations: SoftDeleteViolation[] = [];

  for (const file of files) {
    const pattern = /\.(from|update|delete)\(\s*(\w+)\s*\)/g;
    for (const match of file.text.matchAll(pattern)) {
      const table = match[2] as string;
      if (!tables.has(table)) {
        continue;
      }
      // The enclosing statement: from the previous semicolon to the next.
      const start = file.text.lastIndexOf(";", match.index) + 1;
      const end = file.text.indexOf(";", match.index);
      const statement = file.text.slice(
        start,
        end === -1 ? file.text.length : end,
      );
      if (SCOPE_TOKENS.some((token) => statement.includes(token))) {
        continue;
      }
      violations.push({
        path: file.path,
        line: file.text.slice(0, match.index).split("\n").length,
        message:
          `${match[1]}(${table}) without a soft-delete scope. ` +
          `Use activeOnly(${table}) or the explicit includeDeleted(${table}).`,
      });
    }
  }

  return violations;
}
