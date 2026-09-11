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
/**
 * Waives the expand-then-contract rule for one drop or rename, naming the
 * earlier release that added the replacement (PLAN.md §5.1, P7-T09a).
 *
 * The same shape as the markers above and for the same reason: an exception
 * that has to be written down with a reason is deliberate, and one that does
 * not is an omission nobody notices.
 */
const CONTRACT_OF = "openokr:replaces";

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
/**
 * Characters a WIN1252 database cannot store.
 *
 * Postgres refuses the whole migration, not the comment it sits in, with
 * "character with byte sequence ... has no equivalent in encoding WIN1252".
 * The Windows installer creates a WIN1252 cluster by default, so a migration
 * carrying one of these applies on CI's Linux Postgres and cannot be installed
 * on Windows at all. Migration 0032 shipped 123 box-drawing characters in two
 * decorative comment rules before anybody found out.
 *
 * WIN1252 covers Latin-1 plus a handful of punctuation in 0x80 to 0x9F, which
 * is why the section sign and the em dash this repository uses everywhere are
 * fine and box drawing is not.
 */
const WIN1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const untranslatable = (sql: string): string[] => {
  const found = new Map<string, number>();
  for (const character of sql) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0xff || WIN1252_EXTRAS.has(code)) {
      continue;
    }
    found.set(character, (found.get(character) ?? 0) + 1);
  }
  return [...found].map(
    ([character, count]) =>
      `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")} ` +
      `"${character}" x${count}`,
  );
};

export function lintMigrationSql(fileName: string, sql: string): string[] {
  const problems: string[] = [];

  const unrepresentable = untranslatable(sql);
  if (unrepresentable.length > 0) {
    problems.push(
      `${fileName}: characters a WIN1252 database cannot store, which makes ` +
        `the whole migration refuse on a default Windows Postgres: ` +
        `${unrepresentable.join(", ")}`,
    );
  }

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

  problems.push(...contractProblems(fileName, sql));

  return problems;
}

/**
 * Every `drop column` and `rename column` in the file, with whatever comment
 * markers sit above it.
 *
 * `alter table ... drop constraint` and `drop index` are deliberately not
 * matched. A constraint or an index is not something the previous release
 * reads by name, so removing one cannot break a pod of release N serving
 * against the N+1 schema, which is the only thing this rule exists to
 * prevent.
 */
const REMOVALS =
  /\b(?:drop\s+column(?:\s+if\s+exists)?|rename\s+column)\s+("?[\w.]+"?)/gi;

/**
 * The expand-then-contract rule (PLAN.md §5.1, P7-T09a).
 *
 * **The rule this enforces is a deployment constraint that binds every
 * migration.** On Kubernetes, pods of release N and N+1 serve traffic
 * together against the N+1 schema for the length of a rollout. A migration
 * that drops a column the previous release still selects breaks every
 * request that pod serves, for as long as the rollout takes, and the
 * failure looks like an application error rather than like a schema change.
 *
 * So removing or renaming spans two releases: the first adds the
 * replacement and writes both, the second removes the old. No release both
 * stops writing a column and drops it.
 *
 * **A linter cannot verify that a previous release added the replacement**,
 * because it cannot know which migrations have already shipped to anybody.
 * What it can do is refuse a silent drop. A drop carrying an
 * `openokr:replaces` marker with a reason is somebody stating that the
 * first half happened and saying where; a drop with no marker is the case
 * this exists to catch. The alternative, parsing every earlier migration to
 * guess whether a replacement exists, would be a guess that fails safe in
 * the wrong direction.
 */
/**
 * Where the statement containing `index` begins.
 *
 * The first character after the previous `;`, skipping the whitespace and
 * newlines between them. Comments above a statement sit above that point,
 * which is what `markersAbove` needs handed to it.
 */
function statementStart(sql: string, index: number): number {
  let at = sql.lastIndexOf(";", index) + 1;
  // Skip forward over the blank lines and the comment block between the
  // previous statement and this one. **Past the comments, not up to them**:
  // `markersAbove` reads the lines above the index it is given, so stopping
  // at the first comment line would hand it nothing above and find no
  // marker, which is the bug the two accepting tests caught.
  while (at < index) {
    const character = sql[at] as string;
    if (/\s/.test(character)) {
      at += 1;
      continue;
    }
    if (sql.startsWith("--", at)) {
      const newline = sql.indexOf("\n", at);
      if (newline === -1 || newline >= index) {
        break;
      }
      at = newline + 1;
      continue;
    }
    break;
  }
  return at;
}

function contractProblems(fileName: string, sql: string): string[] {
  const problems: string[] = [];
  for (const match of sql.matchAll(REMOVALS)) {
    const column = stripQuotes(match[1] as string);
    // **From the start of the statement, not the line and not the match.**
    // `markersAbove` walks upward from the index it is given and stops at the
    // first line that is not a comment, so it has to be handed the point
    // where the statement begins. A `drop column` is neither: it sits inside
    // `alter table`, which may be on the same line or the one above it. Pass
    // the match index and it is handed "alter table goals drop " as the line
    // above; pass the line start and the two-line form hands it "alter table
    // goals". Both break out before seeing the marker. Every other caller
    // passes a `create table`, which begins its own statement and its own
    // line, which is why this only ever bit here.
    const { markers } = markersAbove(sql, statementStart(sql, match.index));
    const reason = markers.get(CONTRACT_OF);
    if (reason !== undefined && reason.trim() !== "") {
      continue;
    }
    problems.push(
      `${fileName}: drops or renames "${column}" with no ` +
        `"-- ${CONTRACT_OF}: <the release that added the replacement>" marker. ` +
        `PLAN.md §5.1: removing anything spans two releases, because pods of ` +
        `release N and N+1 serve together against the N+1 schema during a ` +
        `rollout. If the replacement shipped earlier, say so in the marker. ` +
        `If it did not, this migration is the first half and the drop belongs ` +
        `in the next release`,
    );
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
