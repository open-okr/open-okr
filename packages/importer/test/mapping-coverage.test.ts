/**
 * Every table has a row in the importer mapping (completeness review L-14).
 *
 * CLAUDE.md's importer rules say every importable table has a row in
 * TECHNICAL-PLAN.md §7.2, or is marked as having no legacy source, and that the
 * row changes in the same change as the migration. Nothing checked it, and 41
 * tables had no row by the time somebody counted. A table with no row is a
 * question nobody asked: either the source holds something the importer never
 * reads, or it holds nothing and nobody wrote that down.
 *
 * So this reads the document itself rather than a copy of it, and holds it
 * against the schema in both directions: every table has a row, and every
 * table a row names exists.
 *
 * **The tables come from two places, because neither is all of them.** The
 * Drizzle schema defines almost every table, and `cache_entries` exists only
 * in a migration, because the cache driver in `packages/adapters` reads it
 * through plain SQL.
 *
 * **Every parse is floored on its length**, the way `pnpm method:check` is. A
 * pattern that finds nothing agrees with everything, so a count below the
 * floor fails as a broken parse instead of passing as a clean mapping.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCHEMA_DIR = fileURLToPath(
  new URL("../../db/src/schema/", import.meta.url),
);
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../db/migrations/", import.meta.url),
);
const PLAN = fileURLToPath(
  new URL("../../../docs/development-plan/TECHNICAL-PLAN.md", import.meta.url),
);

/**
 * Well under what each source holds today: 138 Drizzle tables, 139 created by
 * migrations, and over 80 mapping rows. The floors catch a parse that has
 * stopped working, not a schema that shrank by a table.
 */
const FLOOR = { schema: 120, migrations: 120, rows: 60, mapped: 120 };

// ── The schema ──────────────────────────────────────────────────────────

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Every `pgTable` call in the schema, and the name each one gives its table.
 *
 * Both are returned so the test can require them to be equal. A table named
 * through a variable or a helper would otherwise drop out of the list without
 * a sound, which is the one way a textual parse of the schema can be wrong.
 */
function drizzleTables(): { calls: number; names: string[] } {
  let calls = 0;
  const names: string[] = [];
  for (const file of readdirSync(SCHEMA_DIR)) {
    if (!file.endsWith(".ts")) {
      continue;
    }
    const code = withoutComments(readFileSync(join(SCHEMA_DIR, file), "utf8"));
    calls += code.match(/\bpgTable\s*\(/g)?.length ?? 0;
    for (const match of code.matchAll(
      /\bpgTable\s*\(\s*"([a-z_][a-z0-9_]*)"/g,
    )) {
      names.push(match[1] as string);
    }
  }
  return { calls, names };
}

const bareName = (identifier: string): string =>
  (identifier.replaceAll('"', "").split(".").at(-1) as string).toLowerCase();

/**
 * The tables the migrations leave behind, read in the order they run.
 *
 * A drop and a rename are applied as well as a create. None has happened yet,
 * and PLAN.md §5.1's two-release rule means one will: when it does, the
 * dropped table stops needing a row rather than being demanded forever.
 */
function migrationTables(): Set<string> {
  const tables = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--.*$/gm, "");
    for (const match of sql.matchAll(
      /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)|\bdrop\s+table\s+(?:if\s+exists\s+)?([\w."]+(?:\s*,\s*[\w."]+)*)|\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+rename\s+to\s+([\w"]+)/gi,
    )) {
      const [, created, dropped, renamedFrom, renamedTo] = match;
      if (created) {
        tables.add(bareName(created));
      } else if (dropped) {
        for (const name of dropped.split(",")) {
          tables.delete(bareName(name.trim()));
        }
      } else if (renamedFrom && renamedTo) {
        tables.delete(bareName(renamedFrom));
        tables.add(bareName(renamedTo));
      }
    }
  }
  return tables;
}

// ── The mapping ─────────────────────────────────────────────────────────

/**
 * One row of §7.2, and what it says about the tables it names.
 *
 * - `sourced`: the Target cell names this product's tables and the Source
 *   cell says what in FlowyTeam fills them, whether or not a mapper reads it
 *   yet.
 * - `none`: the table has no legacy source. Written either way round, since
 *   the section uses both: `No legacy source` in the Target cell with the
 *   tables in the Source cell, or the table in the Target cell with `No legacy
 *   source` in the Source cell.
 * - `source-only`: a FlowyTeam table this product does not import, named in
 *   the Source cell under `Not imported` or `Not read`. It names no table of
 *   this product's, so it is not held against the schema.
 */
interface MappingRow {
  /** 1-based, so a failure points at the line to open. */
  readonly line: number;
  readonly kind: "sourced" | "none" | "source-only";
  readonly tables: readonly string[];
  readonly source: string;
  readonly notes: string;
}

/** A table name in backticks. A dotted one, such as `kpis.formula`, is a column. */
const tableNames = (cell: string): string[] =>
  [...cell.matchAll(/`([a-z_][a-z0-9_]*)`/g)].map(
    (match) => match[1] as string,
  );

const NO_LEGACY_SOURCE = /^no legacy source\b/i;
const NOT_IMPORTED = /^not (?:imported|read)\b/i;

function mappingRows(): MappingRow[] {
  const lines = readFileSync(PLAN, "utf8").split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith("### 7.2 FlowyTeam mapping"),
  );
  if (start === -1) {
    throw new Error(
      "TECHNICAL-PLAN.md has no '### 7.2 FlowyTeam mapping' heading. The parse is wrong, or the section moved.",
    );
  }
  const after = lines.findIndex(
    (line, index) => index > start && /^#{1,3} /.test(line),
  );
  const end = after === -1 ? lines.length : after;

  const rows: MappingRow[] = [];
  for (let index = start + 1; index < end; index++) {
    const line = (lines[index] as string).trim();
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    const [target = "", source = "", notes = ""] = cells;
    if (target === "Target" || cells.every((cell) => /^:?-+:?$/.test(cell))) {
      continue;
    }
    const at = index + 1;
    if (NO_LEGACY_SOURCE.test(target)) {
      rows.push({
        line: at,
        kind: "none",
        tables: tableNames(source),
        source,
        notes,
      });
    } else if (NOT_IMPORTED.test(target)) {
      rows.push({ line: at, kind: "source-only", tables: [], source, notes });
    } else {
      rows.push({
        line: at,
        kind: NO_LEGACY_SOURCE.test(source) ? "none" : "sourced",
        tables: tableNames(target),
        source,
        notes,
      });
    }
  }
  return rows;
}

// ── The claims ──────────────────────────────────────────────────────────

describe("the importer mapping, against the schema", () => {
  const drizzle = drizzleTables();
  const migrated = migrationTables();
  const tables = new Set([...drizzle.names, ...migrated]);
  const rows = mappingRows();
  const mapped = new Set(rows.flatMap((row) => row.tables));

  it("reads every table the schema defines, by the name it gives it", () => {
    expect(drizzle.calls).toBeGreaterThanOrEqual(FLOOR.schema);
    expect(drizzle.names.length).toBe(drizzle.calls);
    expect(migrated.size).toBeGreaterThanOrEqual(FLOOR.migrations);
  });

  it("reads the whole mapping section", () => {
    expect(rows.length).toBeGreaterThanOrEqual(FLOOR.rows);
    expect(mapped.size).toBeGreaterThanOrEqual(FLOOR.mapped);
  });

  /**
   * A row the parse cannot place is a row it would otherwise skip in silence,
   * and a skipped row reads as a table with no row at all.
   */
  it("understands every row: a table it fills, a table with no source, or a source table it leaves", () => {
    const unplaced = rows
      .filter((row) => row.kind !== "source-only" && row.tables.length === 0)
      .map((row) => `line ${row.line}`);
    expect(unplaced).toEqual([]);
  });

  it("acceptance: gives every table a row, with its source or with no legacy source", () => {
    const missing = [...tables].filter((table) => !mapped.has(table)).sort();
    expect(missing).toEqual([]);
  });

  it("names no table that does not exist", () => {
    const unknown = [...mapped].filter((table) => !tables.has(table)).sort();
    expect(unknown).toEqual([]);
  });

  /**
   * A table can have more than one source: `blobs` is filled from task files
   * and from images inline in comments. It cannot have a source and none.
   */
  it("never says a table has a source and has none", () => {
    const sourced = new Set(
      rows.filter((row) => row.kind === "sourced").flatMap((row) => row.tables),
    );
    const both = rows
      .filter((row) => row.kind === "none")
      .flatMap((row) => row.tables)
      .filter((table) => sourced.has(table))
      .sort();
    expect(both).toEqual([]);
  });

  it("says where each table comes from, and why", () => {
    const thin = rows
      .filter((row) => row.kind !== "source-only")
      .filter((row) => row.source.length < 3 || row.notes.length < 20)
      .map((row) => `line ${row.line}`);
    expect(thin).toEqual([]);
  });
});
