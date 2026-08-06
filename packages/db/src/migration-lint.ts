/**
 * The migration linter: the build-time proof behind two hard rules.
 *
 *  1. Every business table carries `workspace_id` and gets a row-level
 *     security policy — enabled AND forced — in the same migration file.
 *  2. Soft delete is the repository-wide default: business tables carry
 *     `deleted_at`.
 *
 * Escapes are explicit comment markers with a written reason, placed on the
 * lines directly above the CREATE TABLE, so every exception is visible in
 * the diff it ships in:
 *
 *   -- openokr:not-tenant-scoped: <why this table holds no workspace data>
 *   -- openokr:hard-delete: <why rows are really removed>
 *   -- openokr:tenant-root: <why this table has no workspace_id of its own>
 *
 * The third marker exists for exactly one table. `workspaces` cannot carry a
 * `workspace_id`, because it is what every other table's `workspace_id` points
 * at. Calling it infrastructure would excuse it from the policy and soft-delete
 * checks as well, which is the last thing that should happen to the table the
 * whole tenant floor rests on. So this marker drops the column requirement and
 * keeps every other one.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const NOT_TENANT_SCOPED = "openokr:not-tenant-scoped";
const HARD_DELETE = "openokr:hard-delete";
const TENANT_ROOT = "openokr:tenant-root";

interface TableStatement {
  readonly name: string;
  /** The column list between the outer parentheses. */
  readonly body: string;
  readonly markers: ReadonlyMap<string, string>;
  readonly problems: readonly string[];
}

const stripQuotes = (identifier: string): string =>
  identifier.replaceAll('"', "").split(".").at(-1) as string;

/** The comment markers on the lines immediately above `index`. */
const markersAbove = (
  sql: string,
  index: number,
): { markers: Map<string, string>; problems: string[] } => {
  const markers = new Map<string, string>();
  const problems: string[] = [];
  const lines = sql.slice(0, index).split("\n");
  // Walk upward through the contiguous comment block, if any.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] as string).trim();
    if (line === "" && i === lines.length - 1) {
      continue; // The create statement's own line fragment.
    }
    if (!line.startsWith("--")) {
      break;
    }
    const match = line.match(/^--\s*(openokr:[a-z-]+):?\s*(.*)$/);
    if (match) {
      const [, marker, reason] = match as unknown as [string, string, string];
      if (reason.trim() === "") {
        problems.push(`marker ${marker} requires a reason after the colon`);
      }
      markers.set(marker, reason.trim());
    }
  }
  return { markers, problems };
};

/** Extracts a balanced `( ... )` body starting at the first paren. */
const parenBody = (sql: string, from: number): string => {
  const open = sql.indexOf("(", from);
  if (open === -1) {
    return "";
  }
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") {
      depth++;
    } else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        return sql.slice(open + 1, i);
      }
    }
  }
  return sql.slice(open + 1);
};

const tableStatements = (sql: string): TableStatement[] => {
  const statements: TableStatement[] = [];
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?)/gi;
  for (const match of sql.matchAll(pattern)) {
    const { markers, problems } = markersAbove(sql, match.index);
    statements.push({
      name: stripQuotes(match[1] as string),
      body: parenBody(sql, match.index + match[0].length),
      markers,
      problems,
    });
  }
  return statements;
};

const has = (sql: string, pattern: RegExp): boolean => pattern.test(sql);

/**
 * Lints one migration file's SQL. Returns human-readable problems; an empty
 * array means the file passes.
 */
export function lintMigrationSql(fileName: string, sql: string): string[] {
  const problems: string[] = [];

  for (const table of tableStatements(sql)) {
    const label = `${fileName}: table ${table.name}`;
    problems.push(...table.problems.map((problem) => `${label}: ${problem}`));

    const infrastructure = table.markers.has(NOT_TENANT_SCOPED);
    const tenantRoot = table.markers.has(TENANT_ROOT);

    if (!infrastructure) {
      if (!tenantRoot && !/\bworkspace_id\b/i.test(table.body)) {
        problems.push(
          `${label}: business tables carry a workspace_id column. ` +
            `Infrastructure tables need an "-- ${NOT_TENANT_SCOPED}: <reason>" marker.`,
        );
      }
      const name = table.name;
      if (
        !has(
          sql,
          new RegExp(
            `alter\\s+table\\s+"?${name}"?\\s+enable\\s+row\\s+level\\s+security`,
            "i",
          ),
        )
      ) {
        problems.push(
          `${label}: missing "enable row level security" in this file`,
        );
      }
      if (
        !has(
          sql,
          new RegExp(
            `alter\\s+table\\s+"?${name}"?\\s+force\\s+row\\s+level\\s+security`,
            "i",
          ),
        )
      ) {
        problems.push(
          `${label}: missing "force row level security" in this file, ` +
            `so the table owner would bypass the tenant floor`,
        );
      }
      if (
        !has(
          sql,
          new RegExp(`create\\s+policy\\s+\\S+\\s+on\\s+"?${name}"?`, "i"),
        )
      ) {
        problems.push(
          `${label}: no row-level security policy created in the same migration file`,
        );
      }
      if (
        !table.markers.has(HARD_DELETE) &&
        !/\bdeleted_at\b/i.test(table.body)
      ) {
        problems.push(
          `${label}: soft delete is the default; add a deleted_at column or an ` +
            `"-- ${HARD_DELETE}: <reason>" marker`,
        );
      }
    }
  }

  return problems;
}

export interface MigrationLintResult {
  readonly file: string;
  readonly problems: readonly string[];
}

/** Lints every `*.sql` file in the given directories. */
export async function lintMigrationDirs(
  dirs: readonly string[],
): Promise<MigrationLintResult[]> {
  const results: MigrationLintResult[] = [];
  for (const dir of dirs) {
    const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [] as string[];
      }
      throw error;
    });
    for (const entry of entries
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(join(dir, entry), "utf8");
      const problems = lintMigrationSql(entry, sql);
      if (problems.length > 0) {
        results.push({ file: join(dir, entry), problems });
      }
    }
  }
  return results;
}
