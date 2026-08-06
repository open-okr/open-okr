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
    // The colon is what makes a marker a marker. Without it,
    // "-- openokr:hard-delete is deliberately absent" reads as the marker
    // being present and waives the very check the sentence says is in force.
    // A marker-shaped comment with no colon is therefore prose, and the table
    // fails the underlying check, which is the safe direction to be wrong in.
    const match = line.match(/^--\s*(openokr:[a-z-]+):\s*(.*)$/);
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

interface PolicyStatement {
  readonly table: string;
  /** From `create policy` to the terminating semicolon. */
  readonly body: string;
}

/**
 * Every `create policy` statement, with the table it applies to.
 *
 * Matching the table name inside the whole file, rather than pairing each
 * policy with its table, let a policy on `invitations` satisfy the
 * requirement for a table called `invitation`. Phase 2 adds several
 * near-identical singular and plural names, so the pairing is now explicit.
 */
const policyStatements = (sql: string): PolicyStatement[] => {
  const statements: PolicyStatement[] = [];
  const pattern = /create\s+policy\s+"?[\w.]+"?\s+on\s+("?[\w.]+"?)/gi;
  for (const match of sql.matchAll(pattern)) {
    const end = sql.indexOf(";", match.index);
    statements.push({
      table: stripQuotes(match[1] as string),
      body: sql.slice(match.index, end === -1 ? sql.length : end),
    });
  }
  return statements;
};

/** `using (true)`, in any spacing. */
const OPEN_USING = /\busing\s*\(\s*true\s*\)/i;

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
      const policies = policyStatements(sql).filter(
        (policy) => policy.table === name,
      );
      if (policies.length === 0) {
        problems.push(
          `${label}: no row-level security policy created in the same migration file`,
        );
      }
      // Postgres combines permissive policies with OR, so a single
      // `using (true)` beside a tenant policy makes the tenant policy
      // decorative. An instance-scope table is the one case where reading
      // without a workspace is the point, and its marker states that.
      if (
        !table.markers.has(INSTANCE_SCOPE) &&
        policies.some((policy) => OPEN_USING.test(policy.body))
      ) {
        problems.push(
          `${label}: a policy reads "using (true)". Permissive policies are ` +
            `combined with OR, so this grants every row to every request and ` +
            `the tenant policy beside it stops meaning anything.`,
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
  /**
   * Directories that yielded no `*.sql` file, whether missing or empty.
   *
   * Reported per directory rather than as one total. A renamed
   * `packages/db/migrations` used to leave the aggregate non-zero because the
   * test fixture directory still had files, so the gate stayed green while
   * checking none of the real schema.
   */
  readonly emptyDirs: readonly string[];
}

/** Lints every `*.sql` file in the given directories. */
export async function lintMigrationDirs(
  dirs: readonly string[],
): Promise<MigrationLintSummary> {
  const results: MigrationLintResult[] = [];
  const emptyDirs: string[] = [];
  let filesChecked = 0;

  for (const dir of dirs) {
    const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [] as string[];
      }
      throw error;
    });
    const files = entries.filter((name) => name.endsWith(".sql")).sort();
    if (files.length === 0) {
      emptyDirs.push(dir);
    }
    for (const entry of files) {
      filesChecked += 1;
      const sql = await readFile(join(dir, entry), "utf8");
      const problems = lintMigrationSql(entry, sql);
      if (problems.length > 0) {
        results.push({ file: join(dir, entry), problems });
      }
    }
  }

  return { results, filesChecked, emptyDirs };
}
