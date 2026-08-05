import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { tenantProbes } from "@openokr/test-support/db-fixtures";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The harness itself: every later task assumes a migrated per-worker database
 * clone with the fixture schema present and fast truncation between tests.
 */

const WORKSPACE = "44444444-4444-4444-8444-444444444444";

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the database test harness", () => {
  it("gives this worker its own migrated clone of the template", async () => {
    const wb = await workerDb();
    expect(wb.databaseName).toMatch(/^openokr_test_/);

    const current = await wb.admin.query("select current_database() as db");
    expect(current.rows[0].db).toBe(wb.databaseName);

    // Migrations ran: the fixture table and the bookkeeping table exist.
    const tables = await wb.admin.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toContain("tenant_probes");
    expect(names).toContain("_migrations");
  });

  it("owns tables through the owner role, not the application role", async () => {
    const wb = await workerDb();
    const owner = await wb.admin.query(
      "select tableowner from pg_tables where tablename = 'tenant_probes'",
    );
    expect(owner.rows[0].tableowner).toBe("openokr_owner");

    const app = await wb.admin.query(
      "select rolbypassrls, rolsuper from pg_roles where rolname = 'openokr_app'",
    );
    expect(app.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("truncates every table except migration bookkeeping", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.db, WORKSPACE, async (tx) => {
      await tx
        .insert(tenantProbes)
        .values({ workspaceId: WORKSPACE, title: "x" });
    });

    await wb.truncateAllTables();

    const probes = await wb.admin.query(
      "select count(*)::int as n from tenant_probes",
    );
    expect(probes.rows[0].n).toBe(0);
    const migrations = await wb.admin.query(
      "select count(*)::int as n from _migrations",
    );
    expect(migrations.rows[0].n).toBeGreaterThan(0);
  });
});
