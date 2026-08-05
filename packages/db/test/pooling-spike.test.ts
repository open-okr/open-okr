import {
  connectionOptions,
  testDbEnv,
  workerDb,
} from "@openokr/test-support/db";
import { tenantProbes } from "@openokr/test-support/db-fixtures";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withWorkspace } from "../src/tenant.ts";

/**
 * The P1-T03 spike (PLAN.md §12 R1): does the SET LOCAL tenant discipline
 * survive a transaction-pooling proxy, where one server connection is handed
 * to a different client after every transaction with no reset in between?
 *
 * Everything here runs through PgBouncer in transaction mode
 * (docker/pgbouncer.ini). The last test demonstrates the failure mode the
 * discipline exists to avoid: a session-level SET leaking across clients.
 * The spike's written decision lives in docs/design/ per EXECUTION-GUIDE §4.
 */

const WORKSPACES = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
] as const;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("tenant isolation through PgBouncer transaction pooling", () => {
  it("keeps 30 concurrent transactions across 3 workspaces fully isolated", async () => {
    const wb = await workerDb();

    // More client connections than PgBouncer server slots (default_pool_size
    // is 5), so server connections are genuinely multiplexed across tenants.
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const workspace = WORKSPACES[i % WORKSPACES.length] as string;
        return withWorkspace(wb.pooledDb, workspace, async (tx) => {
          await tx
            .insert(tenantProbes)
            .values({ workspaceId: workspace, title: `row-${i}` });
          // Hold the transaction open briefly so transactions interleave on
          // the shared server connections rather than running back to back.
          await tx.execute(sql`select pg_sleep(0.01)`);
          const rows = await tx.select().from(tenantProbes);
          for (const row of rows) {
            expect(row.workspaceId).toBe(workspace);
          }
        });
      }),
    );

    // Every insert landed, stamped with the right tenant.
    const byWorkspace = await wb.admin.query(
      "select workspace_id, count(*)::int as n from tenant_probes group by workspace_id order by workspace_id",
    );
    expect(byWorkspace.rows.map((r) => r.n)).toEqual([10, 10, 10]);
  });

  it("returns zero rows to a pooled connection with no workspace setting", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.pooledDb, WORKSPACES[0], async (tx) => {
      await tx
        .insert(tenantProbes)
        .values({ workspaceId: WORKSPACES[0], title: "present" });
    });

    const unset = await wb.pooledAppPool.query(
      "select count(*)::int as n from tenant_probes",
    );
    expect(unset.rows[0].n).toBe(0);
  });

  it("never leaks the setting to whoever gets the server connection next", async () => {
    const wb = await workerDb();
    for (const workspace of WORKSPACES) {
      await withWorkspace(wb.pooledDb, workspace, (tx) =>
        tx.select().from(tenantProbes),
      );
      const setting = await wb.pooledAppPool.query(
        "select current_setting('app.workspace_id', true) as v",
      );
      expect([null, ""]).toContain(setting.rows[0].v);
    }
  });

  it("demonstrates the leak a session-level SET would cause", async () => {
    // A fixed database that PgBouncer serves with exactly one server
    // connection (pool_size=1), so both clients below share it and the
    // failure mode is deterministic.
    const connect = async () => {
      const client = new pg.Client(
        connectionOptions(
          testDbEnv.spikeLeakDatabase,
          testDbEnv.superuser,
          testDbEnv.pgbouncerPort,
        ),
      );
      await client.connect();
      return client;
    };

    const first = await connect();
    const second = await connect();
    try {
      await first.query("reset all");

      // The wrong discipline: a session-level SET outside any transaction.
      await first.query("set app.workspace_id = 'leaked-value'");

      // A different client, next transaction on the same server connection:
      // it inherits the other tenant's setting. This is the R1 risk made
      // concrete, and why the wrapper only ever uses SET LOCAL.
      const leaked = await second.query(
        "select current_setting('app.workspace_id', true) as v",
      );
      expect(leaked.rows[0].v).toBe("leaked-value");

      await first.query("reset all");

      // The right discipline: SET LOCAL inside a transaction dies with it.
      await first.query("begin");
      await first.query(
        "select set_config('app.workspace_id', 'local-value', true)",
      );
      await first.query("commit");
      const clean = await second.query(
        "select current_setting('app.workspace_id', true) as v",
      );
      expect([null, ""]).toContain(clean.rows[0].v);
    } finally {
      await first.query("reset all").catch(() => {});
      await first.end();
      await second.end();
    }
  });
});
