import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { beforeAll, describe, expect, it } from "vitest";
import { inTenantTransaction } from "../src/perf/bulk.ts";
import { buildLargeDataset } from "../src/perf/large-dataset.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The tenant property and fuzz suite (P7-T03, TECHNICAL-PLAN §2 and §8.2,
 * PLAN.md §12 R1).
 *
 * **`isolation.test.ts` proves the mechanism on one fixture table. This proves
 * the coverage on all of them.** A tenant floor is only as good as the table
 * somebody forgot, and the migration linter can only see the migration that
 * added one: a policy dropped by a later migration, or a table created outside
 * the linter's sight, is invisible to it and visible here.
 *
 * Three properties, and the third is what makes the first two trustworthy:
 *
 * 1. Every table carrying `workspace_id` has row-level security enabled,
 *    forced, and at least one policy that reads `app.workspace_id`. Forced
 *    matters on its own: without it the table owner bypasses the policy, and
 *    migrations run as the owner.
 * 2. A workspace that holds nothing sees nothing, in every one of those
 *    tables, while another workspace holds a full dataset. Random workspace
 *    ids as well as a real one, because "the policy compares to the setting"
 *    and "the policy happens to match this row" are different claims.
 * 3. **The suite can fail.** Row-level security is turned off on one table
 *    and the probe is expected to find rows. A tenant test that cannot
 *    distinguish a protected table from an unprotected one is decoration, and
 *    this is the only assertion here that proves it can.
 */

let workspaceA: string;
let tables: string[];

/** Every table the tenant floor is supposed to cover. */
async function workspaceTables(): Promise<string[]> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ table_name: string }>(
    `select c.relname as table_name
       from pg_class c
       join pg_namespace ns on ns.oid = c.relnamespace
       join information_schema.columns col
         on col.table_name = c.relname
        and col.table_schema = 'public'
        and col.column_name = 'workspace_id'
      where ns.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  return rows.rows.map((row) => row.table_name);
}

beforeAll(async () => {
  const wb = await workerDb();
  const userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Tenant", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Tenant ${userId.slice(0, 8)}`,
  });
  workspaceA = provisioned.workspaceId;
  // Real rows across many domains, so the probes below are looking at
  // something. Provisioning alone fills a dozen tables; the dataset adds
  // goals, key results, initiatives, tasks and every access row.
  await buildLargeDataset({
    pool: wb.appPool,
    workspaceId: workspaceA,
    counts: {
      spaces: 2,
      members: 4,
      cycles: 2,
      goals: 6,
      keyResults: 6,
      initiatives: 2,
      tasks: 12,
    },
    batchSize: 50,
    nodeEnv: "test",
  });
  tables = await workspaceTables();
}, 120_000);

describe("every workspace-scoped table is on the tenant floor", () => {
  it("finds the tables to check at all", () => {
    // A query that matched nothing would make every assertion below vacuous.
    expect(tables.length).toBeGreaterThan(100);
  });

  it("has row-level security enabled and forced on each one", async () => {
    const wb = await workerDb();
    const rows = await wb.admin.query<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
    }>(
      `select c.relname as table_name, c.relrowsecurity as enabled,
              c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relname = any($1::text[])`,
      [tables],
    );
    // Forced as well as enabled. Without `force`, the owning role skips the
    // policy entirely, and migrations run as the owner.
    const unprotected = rows.rows
      .filter((row) => !row.enabled || !row.forced)
      .map((row) => row.table_name);
    expect(unprotected).toEqual([]);
  });

  it("has a policy that reads the tenant setting on each one", async () => {
    const wb = await workerDb();
    const rows = await wb.admin.query<{ tablename: string; qual: string }>(
      `select tablename, coalesce(qual, '') || ' ' || coalesce(with_check, '') as qual
         from pg_policies
        where schemaname = 'public' and tablename = any($1::text[])`,
      [tables],
    );
    const withSetting = new Set(
      rows.rows
        .filter((row) => row.qual.includes("app.workspace_id"))
        .map((row) => row.tablename),
    );
    // A table with row-level security on and no policy is not protected: it
    // is unreadable, which looks like protection until somebody adds a
    // permissive policy to fix the outage.
    const missing = tables.filter((table) => !withSetting.has(table));
    expect(missing).toEqual([]);
  });
});

describe("a workspace sees nothing that is not its own", () => {
  it("reads zero rows from every table as a workspace that holds nothing", async () => {
    const wb = await workerDb();
    const stranger = newId();
    const leaks: string[] = [];
    await inTenantTransaction(wb.appPool, stranger, async (client) => {
      for (const table of tables) {
        const result = await client.query<{ n: string }>(
          `select count(*)::text as n from "${table}"`,
        );
        if (Number(result.rows[0]?.n ?? "0") > 0) {
          leaks.push(table);
        }
      }
    });
    expect(leaks).toEqual([]);
  });

  it("reads zero rows for twenty random workspace ids", async () => {
    const wb = await workerDb();
    const leaks: string[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const stranger = newId();
      // A different table each time, so twenty attempts cover twenty tables
      // rather than probing the same one twenty ways.
      const table = tables[attempt % tables.length] as string;
      await inTenantTransaction(wb.appPool, stranger, async (client) => {
        const result = await client.query<{ n: string }>(
          `select count(*)::text as n from "${table}"`,
        );
        if (Number(result.rows[0]?.n ?? "0") > 0) {
          leaks.push(`${table} for ${stranger}`);
        }
      });
    }
    expect(leaks).toEqual([]);
  });

  it("refuses a write that names another workspace", async () => {
    const wb = await workerDb();
    const stranger = newId();
    // The `with check` half of the policy. A tenant that can read nothing but
    // write anywhere is not isolated.
    await expect(
      inTenantTransaction(wb.appPool, stranger, (client) =>
        client.query(
          "insert into access_contexts (id, workspace_id, resource_type, resource_id) values ($1, $2, 'goal', $3)",
          [newId(), workspaceA, newId()],
        ),
      ),
    ).rejects.toThrow();
  });

  it("still shows the owning workspace its own rows", async () => {
    // The other half of the property. A floor that hid everything from
    // everybody would pass every assertion above.
    const wb = await workerDb();
    const seen = await inTenantTransaction(
      wb.appPool,
      workspaceA,
      async (client) => {
        const result = await client.query<{ n: string }>(
          "select count(*)::text as n from goals",
        );
        return Number(result.rows[0]?.n ?? "0");
      },
    );
    expect(seen).toBe(6);
  });
});

describe("the suite can tell a protected table from an unprotected one", () => {
  it("finds rows once row-level security is turned off", async () => {
    const wb = await workerDb();
    const stranger = newId();
    // The mutation. Without this assertion every test above could be passing
    // because the connection reads nothing at all, and nobody would know.
    await wb.admin.query("alter table goals disable row level security");
    try {
      const leaked = await inTenantTransaction(
        wb.appPool,
        stranger,
        async (client) => {
          const result = await client.query<{ n: string }>(
            "select count(*)::text as n from goals",
          );
          return Number(result.rows[0]?.n ?? "0");
        },
      );
      expect(leaked).toBeGreaterThan(0);
    } finally {
      await wb.admin.query("alter table goals enable row level security");
      await wb.admin.query("alter table goals force row level security");
    }
  });

  it("puts the floor back, so the rest of the suite is unaffected", async () => {
    const wb = await workerDb();
    const stranger = newId();
    const seen = await inTenantTransaction(
      wb.appPool,
      stranger,
      async (client) => {
        const result = await client.query<{ n: string }>(
          "select count(*)::text as n from goals",
        );
        return Number(result.rows[0]?.n ?? "0");
      },
    );
    expect(seen).toBe(0);
  });
});
