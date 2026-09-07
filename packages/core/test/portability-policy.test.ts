/**
 * The archive's policy list, against the real schema (P6-T05a).
 *
 * Every assertion here reads the live database rather than the TypeScript
 * schema. That is deliberate: `packages/db` exports its tables one by one with
 * no barrel, so a table a migration created without a Drizzle definition would
 * be invisible to a schema-based check and present in the database. The
 * database is the authority on what exists.
 *
 * Four claims, and each one fails a build rather than an archive:
 *
 * 1. every table is classified, so a new one cannot be quietly left out;
 * 2. the export order is a real topological order, so an archive can be
 *    loaded rather than only written;
 * 3. every circular foreign key is broken by a deferred column, so an order
 *    exists at all;
 * 4. every deferred column is nullable, because a second pass cannot write a
 *    column the first pass had to fill.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFERRED_COLUMNS,
  EXCLUDED_TABLES,
  EXPORTED_TABLES,
  isDeferred,
  policyFor,
  TABLE_POLICY,
} from "../src/portability/policy.ts";

interface ForeignKey {
  readonly child: string;
  readonly col: string;
  readonly parent: string;
  readonly nullable: boolean;
}

/**
 * Tables the suite creates for itself, which no migration made.
 *
 * `access_probes` and `tenant_probes` exist because a test in `packages/db`
 * and one in `packages/core` need a table to prove row-level security and the
 * soft-delete scope against without depending on a business table's shape.
 * They are in the worker database and not in any instance, so the policy list
 * must not carry them.
 *
 * Named rather than pattern-matched, so a third one fails this test and
 * whoever adds it decides here rather than leaving a table unclassified.
 */
const TEST_ONLY_TABLES: readonly string[] = ["access_probes", "tenant_probes"];

let tables: string[] = [];
let foreignKeys: ForeignKey[] = [];

beforeAll(async () => {
  const wb = await workerDb();
  tables = (
    await wb.admin.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    )
  ).rows
    .map((row) => row.table_name)
    .filter((table) => !TEST_ONLY_TABLES.includes(table));

  foreignKeys = (
    await wb.admin.query<{
      child: string;
      col: string;
      parent: string;
      is_nullable: string;
    }>(
      `select tc.table_name as child, kcu.column_name as col,
              ccu.table_name as parent, c.is_nullable
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name
          and kcu.table_schema = tc.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
          and ccu.table_schema = tc.table_schema
         join information_schema.columns c
           on c.table_schema = tc.table_schema
          and c.table_name = tc.table_name
          and c.column_name = kcu.column_name
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public'`,
    )
  ).rows.map((row) => ({
    child: row.child,
    col: row.col,
    parent: row.parent,
    nullable: row.is_nullable === "YES",
  }));
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the archive policy list", () => {
  it("classifies every table the database has", () => {
    // Named rather than compared as two arrays, so the failure says which
    // table nobody decided about.
    const unclassified = tables.filter(
      (table) => policyFor(table) === undefined,
    );
    expect(unclassified).toEqual([]);
  });

  /**
   * An **exported** table has to exist, because the archive queries it. An
   * **excluded** one does not: `_data_changes` is created by the data-change
   * runner on its first run rather than by a migration, so a fresh database
   * has no such table and an instance that has run one backfill does. Naming
   * it either way is right; querying it would not be.
   */
  it("exports no table the database does not have", () => {
    const missing = EXPORTED_TABLES.filter((table) => !tables.includes(table));
    expect(missing).toEqual([]);
  });

  it("classifies each table once", () => {
    const seen = new Set<string>();
    const twice: string[] = [];
    for (const entry of TABLE_POLICY) {
      if (seen.has(entry.table)) {
        twice.push(entry.table);
      }
      seen.add(entry.table);
    }
    expect(twice).toEqual([]);
  });

  it("gives every table a reason somebody can read", () => {
    const thin = TABLE_POLICY.filter(
      (entry) => entry.reason.trim().length < 12,
    ).map((entry) => entry.table);
    expect(thin).toEqual([]);
    const unpunctuated = TABLE_POLICY.filter(
      (entry) => !entry.reason.trim().endsWith("."),
    ).map((entry) => entry.table);
    expect(unpunctuated).toEqual([]);
  });

  /**
   * The five classes §7.3 names by hand. Spelled out here rather than left to
   * the reasons above, because these are the ones a leak would matter for and
   * a future edit must not quietly reclassify.
   */
  it("excludes every secret, session, token, channel credential and the audit chain", () => {
    for (const table of [
      "accounts",
      "sessions",
      "verifications",
      "passkeys",
      "two_factors",
      "api_tokens",
      "device_authorisations",
      "invite_links",
      "oauth_clients",
      "oauth_codes",
      "oauth_grants",
      "oauth_access_tokens",
      "oauth_refresh_tokens",
      "mcp_sessions",
      "ai_credentials",
      "channel_connections",
      "channel_installations",
      "channel_link_codes",
      "channel_identities",
      "audit_events",
      "instance_audit_events",
      "system_settings",
    ]) {
      expect(policyFor(table)?.decision, table).toBe("exclude");
    }
  });

  it("exports the workspace row and the access model, or the archive is unreadable", () => {
    for (const table of [
      "workspaces",
      "workspace_members",
      "spaces",
      "access_contexts",
      "access_groups",
      "access_group_memberships",
      "access_bindings",
      "goals",
      "key_results",
      "check_ins",
      "okr_sessions",
      "documents",
    ]) {
      expect(policyFor(table)?.decision, table).toBe("export");
    }
  });

  it("carries no table without a workspace_id except the workspace itself", async () => {
    const wb = await workerDb();
    const scoped = (
      await wb.admin.query<{ table_name: string }>(
        `select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'workspace_id'`,
      )
    ).rows.map((row) => row.table_name);

    const unscoped = EXPORTED_TABLES.filter(
      (table) => table !== "workspaces" && !scoped.includes(table),
    );
    // A table with no workspace_id cannot be exported for one workspace: there
    // is no clause that selects this workspace's rows and nobody else's.
    expect(unscoped).toEqual([]);
  });
});

describe("the export order", () => {
  /**
   * The order is what makes an archive loadable rather than only writable. A
   * table placed ahead of one it references would produce a file that fails on
   * its first insert, and only against a populated workspace.
   */
  it("is a topological order once the deferred columns are set aside", () => {
    const exported = new Set(EXPORTED_TABLES);
    const written = new Set<string>();
    const tooEarly: string[] = [];

    for (const table of EXPORTED_TABLES) {
      for (const key of foreignKeys) {
        if (key.child !== table || key.parent === table) {
          continue;
        }
        if (isDeferred(key.child, key.col)) {
          continue;
        }
        // A reference to an excluded table is not an ordering problem: the
        // import resolves or drops it rather than waiting for a row.
        if (!exported.has(key.parent)) {
          continue;
        }
        if (!written.has(key.parent)) {
          tooEarly.push(`${table}.${key.col} needs ${key.parent} first`);
        }
      }
      written.add(table);
    }

    expect(tooEarly).toEqual([]);
  });

  it("holds every exported table exactly once", () => {
    expect(new Set(EXPORTED_TABLES).size).toBe(EXPORTED_TABLES.length);
    expect(EXPORTED_TABLES.length + EXCLUDED_TABLES.length).toBe(
      TABLE_POLICY.length,
    );
  });
});

describe("the deferred columns", () => {
  it("names only columns the database has", () => {
    const missing = DEFERRED_COLUMNS.filter((name) => {
      const [table, column] = name.split(".");
      return !foreignKeys.some(
        (key) => key.child === table && key.col === column,
      );
    });
    expect(missing).toEqual([]);
  });

  /**
   * A second pass writes these after the rows exist, which is only possible
   * if the first pass may leave them empty.
   */
  it("names only nullable columns", () => {
    const notNull = DEFERRED_COLUMNS.filter((name) => {
      const [table, column] = name.split(".");
      return foreignKeys.some(
        (key) => key.child === table && key.col === column && !key.nullable,
      );
    });
    expect(notNull).toEqual([]);
  });

  /**
   * The invariant the whole order rests on. The schema has circular foreign
   * keys: a goal points at its latest check-in and a check-in at its goal, a
   * KPI at its tree and a tree at its root KPI. Every such cycle has to be cut
   * by a column the import can fill later, and a NOT NULL circular reference
   * added in future would be a schema no archive could load. This finds it.
   */
  it("breaks every cycle among exported tables", () => {
    const exported = new Set(EXPORTED_TABLES);
    const edges = new Map<string, string[]>();
    for (const key of foreignKeys) {
      if (key.child === key.parent) {
        continue;
      }
      if (!exported.has(key.child) || !exported.has(key.parent)) {
        continue;
      }
      if (isDeferred(key.child, key.col)) {
        continue;
      }
      const list = edges.get(key.child) ?? [];
      list.push(key.parent);
      edges.set(key.child, list);
    }

    // Kahn: anything left over is in a cycle the deferred list did not cut.
    const remaining = new Set(exported);
    let moved = true;
    while (moved) {
      moved = false;
      for (const table of [...remaining]) {
        const needs = (edges.get(table) ?? []).filter((parent) =>
          remaining.has(parent),
        );
        if (needs.length === 0) {
          remaining.delete(table);
          moved = true;
        }
      }
    }

    expect([...remaining].sort()).toEqual([]);
  });
});
