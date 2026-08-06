import { workerDb } from "@openokr/test-support/db";
import { tenantProbes } from "@openokr/test-support/db-fixtures";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeOnly,
  includeDeleted,
  softDeleteRows,
} from "../src/soft-delete.ts";
import {
  collectSoftDeletableTables,
  lintSoftDeleteUsage,
} from "../src/soft-delete-lint.ts";
import { withWorkspace } from "../src/tenant.ts";

/**
 * Soft delete is the repository-wide default (TECHNICAL-PLAN §3): reads
 * exclude deleted rows through `activeOnly`, and seeing them again is the
 * explicit `includeDeleted` opt-in. The lint makes forgetting either one a
 * build failure rather than a code-review hope.
 */

const WORKSPACE = "33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await withWorkspace(wb.db, WORKSPACE, async (tx) => {
    await tx.insert(tenantProbes).values([
      { workspaceId: WORKSPACE, title: "keep" },
      { workspaceId: WORKSPACE, title: "gone" },
    ]);
    await softDeleteRows(tx, tenantProbes, eq(tenantProbes.title, "gone"));
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the soft-delete scope", () => {
  it("hides deleted rows from the default scope", async () => {
    const wb = await workerDb();
    const rows = await withWorkspace(wb.db, WORKSPACE, (tx) =>
      tx.select().from(tenantProbes).where(activeOnly(tenantProbes)),
    );
    expect(rows.map((r) => r.title)).toEqual(["keep"]);
  });

  it("reveals them through the explicit opt-in", async () => {
    const wb = await workerDb();
    const rows = await withWorkspace(wb.db, WORKSPACE, (tx) =>
      tx.select().from(tenantProbes).where(includeDeleted(tenantProbes)),
    );
    expect(rows.map((r) => r.title).sort()).toEqual(["gone", "keep"]);
  });

  it("composes extra conditions under both scopes", async () => {
    const wb = await workerDb();
    const active = await withWorkspace(wb.db, WORKSPACE, (tx) =>
      tx
        .select()
        .from(tenantProbes)
        .where(activeOnly(tenantProbes, eq(tenantProbes.title, "gone"))),
    );
    expect(active).toEqual([]);

    const all = await withWorkspace(wb.db, WORKSPACE, (tx) =>
      tx
        .select()
        .from(tenantProbes)
        .where(includeDeleted(tenantProbes, eq(tenantProbes.title, "gone"))),
    );
    expect(all.map((r) => r.title)).toEqual(["gone"]);
  });

  it("soft delete stamps deleted_at instead of removing the row", async () => {
    const wb = await workerDb();
    const raw = await wb.admin.query(
      "select title, deleted_at from tenant_probes order by title",
    );
    expect(raw.rows).toHaveLength(2);
    const gone = raw.rows.find((r) => r.title === "gone");
    expect(gone.deleted_at).toBeInstanceOf(Date);
  });
});

describe("collectSoftDeletableTables", () => {
  it("finds exported drizzle tables that carry deleted_at", () => {
    const schema = `
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
});
`;
    expect(collectSoftDeletableTables([schema])).toEqual(new Set(["goals"]));
  });

  it("finds the real shipped schema, so the gate cannot go quietly empty", async () => {
    // The registry is built by reading `packages/db/src/schema` from disk. When
    // that read returned nothing, the lint still passed, reporting "0
    // soft-deletable tables" and checking nothing at all. A gate that fails
    // open is worse than no gate, so this reads the shipped schema the way the
    // command does and insists on finding what is actually there.
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const schemaDir = join(import.meta.dirname, "../src/schema");

    const sources = await Promise.all(
      (await readdir(schemaDir))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => readFile(join(schemaDir, file), "utf8")),
    );

    const tables = collectSoftDeletableTables(sources);
    expect(tables.size).toBeGreaterThan(0);
    expect(tables).toContain("workspaces");
    expect(tables).toContain("workspaceMembers");
  });
});

describe("lintSoftDeleteUsage", () => {
  const tables = new Set(["goals"]);

  it("flags a read of a soft-deletable table without a scope", () => {
    const text = `const rows = await tx.select().from(goals).where(eq(goals.id, id));`;
    const violations = lintSoftDeleteUsage([{ path: "a.ts", text }], tables);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe("a.ts");
  });

  it("accepts the default scope and the explicit opt-in", () => {
    const scoped = `const rows = await tx.select().from(goals).where(activeOnly(goals));`;
    const optIn = `const rows = await tx.select().from(goals).where(includeDeleted(goals));`;
    expect(
      lintSoftDeleteUsage([{ path: "a.ts", text: scoped }], tables),
    ).toEqual([]);
    expect(
      lintSoftDeleteUsage([{ path: "a.ts", text: optIn }], tables),
    ).toEqual([]);
  });

  it("flags updates and deletes that target a soft-deletable table unscoped", () => {
    const update = `await tx.update(goals).set({ title }).where(eq(goals.id, id));`;
    const remove = `await tx.delete(goals).where(eq(goals.id, id));`;
    expect(
      lintSoftDeleteUsage([{ path: "u.ts", text: update }], tables),
    ).toHaveLength(1);
    expect(
      lintSoftDeleteUsage([{ path: "d.ts", text: remove }], tables),
    ).toHaveLength(1);
  });

  it("ignores tables that are not soft-deletable", () => {
    const text = `const rows = await tx.select().from(auditLog);`;
    expect(lintSoftDeleteUsage([{ path: "a.ts", text }], tables)).toEqual([]);
  });

  it("reports the offending line number", () => {
    const text = `const a = 1;\nconst rows = await tx.select().from(goals);\n`;
    const violations = lintSoftDeleteUsage([{ path: "a.ts", text }], tables);
    expect(violations[0]?.line).toBe(2);
  });
});
