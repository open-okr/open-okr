import { workerDb } from "@openokr/test-support/db";
import { tenantProbes } from "@openokr/test-support/db-fixtures";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withWorkspace } from "../src/tenant.ts";

/**
 * The tenant floor (TECHNICAL-PLAN §2, PLAN.md §12 R1), tested against the
 * real application role over a direct connection. The same suite runs through
 * PgBouncer in pooling-spike.test.ts.
 */

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await withWorkspace(wb.db, WORKSPACE_A, async (tx) => {
    await tx.insert(tenantProbes).values([
      { workspaceId: WORKSPACE_A, title: "a1" },
      { workspaceId: WORKSPACE_A, title: "a2" },
    ]);
  });
  await withWorkspace(wb.db, WORKSPACE_B, async (tx) => {
    await tx
      .insert(tenantProbes)
      .values({ workspaceId: WORKSPACE_B, title: "b1" });
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("row-level security isolation", () => {
  it("shows each workspace only its own rows", async () => {
    const wb = await workerDb();
    const aRows = await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx.select().from(tenantProbes),
    );
    expect(aRows.map((r) => r.title).sort()).toEqual(["a1", "a2"]);

    const bRows = await withWorkspace(wb.db, WORKSPACE_B, (tx) =>
      tx.select().from(tenantProbes),
    );
    expect(bRows.map((r) => r.title)).toEqual(["b1"]);
  });

  it("hides other workspaces even from raw SQL on the application role", async () => {
    const wb = await workerDb();
    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [
        WORKSPACE_A,
      ]);
      const raw = await client.query(
        "select title from tenant_probes order by title",
      );
      expect(raw.rows.map((r) => r.title)).toEqual(["a1", "a2"]);
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("returns zero rows on a connection with no workspace setting", async () => {
    const wb = await workerDb();

    // The rows really are there: the superuser sees all three.
    const all = await wb.admin.query(
      "select count(*)::int as n from tenant_probes",
    );
    expect(all.rows[0].n).toBe(3);

    // The application role with no workspace applied sees none of them.
    const unset = await wb.appPool.query(
      "select count(*)::int as n from tenant_probes",
    );
    expect(unset.rows[0].n).toBe(0);
  });

  it("rejects a write stamped with a different workspace than the setting", async () => {
    const wb = await workerDb();
    // Drizzle wraps the driver error; the row-level security violation is in
    // the cause chain.
    const failure = await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx
        .insert(tenantProbes)
        .values({ workspaceId: WORKSPACE_B, title: "smuggled" }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const messages: string[] = [];
    for (
      let e = failure as Error | undefined;
      e;
      e = e.cause as Error | undefined
    ) {
      messages.push(e.message);
    }
    expect(messages.join(" | ")).toMatch(/row-level security|policy/i);

    // And nothing was smuggled in.
    const raw = await wb.admin.query(
      "select count(*)::int as n from tenant_probes where title = 'smuggled'",
    );
    expect(raw.rows[0].n).toBe(0);
  });

  it("makes cross-workspace updates and deletes touch nothing", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.db, WORKSPACE_A, async (tx) => {
      const updated = await tx
        .update(tenantProbes)
        .set({ title: "defaced" })
        .where(eq(tenantProbes.title, "b1"))
        .returning();
      expect(updated).toEqual([]);

      const deleted = await tx
        .delete(tenantProbes)
        .where(eq(tenantProbes.workspaceId, WORKSPACE_B))
        .returning();
      expect(deleted).toEqual([]);
    });

    const intact = await withWorkspace(wb.db, WORKSPACE_B, (tx) =>
      tx.select().from(tenantProbes),
    );
    expect(intact.map((r) => r.title)).toEqual(["b1"]);
  });

  it("keeps the workspace setting transaction-local, never on the session", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx.select().from(tenantProbes),
    );

    // After the transaction ends the same pool must be back to zero rows.
    const after = await wb.appPool.query(
      "select count(*)::int as n from tenant_probes",
    );
    expect(after.rows[0].n).toBe(0);
  });
});

describe("withWorkspace input validation", () => {
  it("rejects a workspace id that is not a UUID, before touching the database", async () => {
    const wb = await workerDb();
    await expect(
      withWorkspace(wb.db, "1; drop table tenant_probes; --", (tx) =>
        tx.select().from(tenantProbes),
      ),
    ).rejects.toThrow(/workspace id/i);
  });

  it("passes the callback result through", async () => {
    const wb = await workerDb();
    const result = await withWorkspace(wb.db, WORKSPACE_A, async () => "value");
    expect(result).toBe("value");
  });
});
