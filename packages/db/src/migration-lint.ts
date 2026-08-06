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
 *   -- openokr:instance-scope: <why this table sits above every workspace>
 *
 * The last two are for tables that genuinely cannot carry a `workspace_id`,
 * for opposite reasons, and both keep every other check.
 *
 * `workspaces` is the tenant root: it is what every other table's
 * `workspace_id` points at, so it cannot hold one.
 *
 * `system_settings` is instance scope: it sits above every workspace rather
 * than beneath one. Calling either infrastructure would waive the policy and
 * soft-delete checks too, and these are the tables the tenant floor rests on
 * and the instance's credentials live in. So these markers drop the column
 * requirement and nothing else.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const NOT_TENANT_SCOPED = "openokr:not-tenant-scoped";
const HARD_DELETE = "openokr:hard-delete";
const TENANT_ROOT = "openokr:tenant-root";
const INSTANCE_SCOPE = "openokr:instance-scope";

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
    // Both waive the column and nothing else. See the file comment.
    const unscopedByDesign =
      table.markers.has(TENANT_ROOT) || table.markers.has(INSTANCE_SCOPE);

    if (!infrastructure) {
      if (!unscopedByDesign && !/\bworkspace_id\b/i.test(table.body)) {
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

/**
 * What the lint found, and how much it looked at.
 *
 * The count is not decoration. A missing directory yields no files and no
 * problems, which is indistinguishable from a clean pass unless the number of
 * files checked is reported. Two gates in this repository have already
 * announced success while inspecting nothing.
 */
export interface MigrationLintSummary {
  readonly results: readonly MigrationLintResult[];
  readonly filesChecked: number;
}

/** Lints every `*.sql` file in the given directories. */
export async function lintMigrationDirs(
  dirs: readonly string[],
): Promise<MigrationLintSummary> {
  const results: MigrationLintResult[] = [];
  let filesChecked = 0;

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
      filesChecked += 1;
      const sql = await readFile(join(dir, entry), "utf8");
      const problems = lintMigrationSql(entry, sql);
      if (problems.length > 0) {
        results.push({ file: join(dir, entry), problems });
      }
    }
  }

  return { results, filesChecked };
}
