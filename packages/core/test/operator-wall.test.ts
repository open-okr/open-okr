import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  isLiveOperator,
  listTenantsAsOperator,
  measureAllWorkspaces,
  readUsageAsOperator,
} from "../src/operator/index.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY } from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * The wall between an operator and the content (P8-T03a, design in
 * `docs/design/p8-t01b-operator-console.md` §1).
 *
 * The design's central claim is that the wall is the **absence of a policy**
 * rather than a check in application code. So the load-bearing test here is
 * not about any function: it points a real operator connection at every table
 * that carries a `workspace_id` and requires zero rows from all of them.
 *
 * That is deliberately the same shape as the P7-T03a tenant fuzz suite, and
 * for the same reason: a claim about every table has to be tested against
 * every table, because the one somebody adds next month is exactly the one a
 * fixture would miss.
 */

const ring = parseKeyRing({ current: newRootKey() });
const OPERATOR = "the-operator";
const OWNER = "the-owner";

let workspaceId: string;
let contentTables: string[];

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const grantOperator = async (userId = OPERATOR) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into instance_operators (user_id, granted_by_user_id) values ($1, $2)",
    [userId, OWNER],
  );
};

/** Every table the tenant floor covers, minus the ones an operator may see. */
const NAMED_FOR_OPERATORS = new Set(["tenants"]);

beforeAll(async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ table_name: string }>(
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
  contentTables = rows
    .map((row) => row.table_name)
    .filter((name) => !NAMED_FOR_OPERATORS.has(name));
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await wb.admin.query("delete from instance_operators");
  await writeSettings(wb.appPool, ring, [
    { key: CLOUD_ENABLED_KEY, value: true },
  ]);
  await seedUser(OWNER);
  await seedUser(OPERATOR);
  const provisioned = await createWorkspace(wb.appPool, {
    user: { id: OWNER, name: "The Owner" },
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the wall", () => {
  it("returns zero rows from every content table, on a real operator connection", async () => {
    const wb = await workerDb();
    await grantOperator();

    // A provisioned workspace has rows in a good number of these: members,
    // access contexts, groups, bindings, the default space, rhythm settings,
    // the current cycle, both agents, the activity and the audit row. So an
    // empty answer here is the policy working rather than an empty database.
    const client = await wb.appPool.connect();
    const nonEmpty: string[] = [];
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.operator_user_id', $1, true)",
        [OPERATOR],
      );
      for (const table of contentTables) {
        const { rows } = await client.query(
          `select count(*)::int as n from "${table}"`,
        );
        if (rows[0].n !== 0) {
          nonEmpty.push(`${table} (${rows[0].n})`);
        }
      }
      await client.query("commit");
    } finally {
      client.release();
    }

    expect(nonEmpty, "tables an operator could read").toEqual([]);
    expect(contentTables.length).toBeGreaterThan(100);
  });

  it("proves the probe can fail, by reading the one table operators may see", async () => {
    // A wall test that cannot distinguish a reachable table from an
    // unreachable one is decoration. This is the assertion that proves it can.
    const wb = await workerDb();
    await grantOperator();
    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.operator_user_id', $1, true)",
        [OPERATOR],
      );
      const { rows } = await client.query(
        "select count(*)::int as n from tenants",
      );
      expect(rows[0].n).toBe(1);
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("shows an operator with no grant nothing at all", async () => {
    const wb = await workerDb();
    // No `grantOperator`. The setting is applied and matches no live row.
    await expect(listTenantsAsOperator(wb.appPool, OPERATOR)).resolves.toEqual(
      [],
    );
  });

  it("stops a revoked operator at the database, not at their next sign-in", async () => {
    const wb = await workerDb();
    await grantOperator();
    await expect(
      listTenantsAsOperator(wb.appPool, OPERATOR),
    ).resolves.toHaveLength(1);

    await wb.admin.query(
      "update instance_operators set revoked_at = now() where user_id = $1",
      [OPERATOR],
    );

    // Same connection pool, same function, no sign-out in between.
    await expect(listTenantsAsOperator(wb.appPool, OPERATOR)).resolves.toEqual(
      [],
    );
    await expect(isLiveOperator(wb.appPool, OPERATOR)).resolves.toBe(false);
  });
});

describe("what an operator does see", () => {
  it("lists tenants with their metadata and no content", async () => {
    const wb = await workerDb();
    await grantOperator();
    const [row] = await listTenantsAsOperator(wb.appPool, OPERATOR);
    expect(row).toMatchObject({
      workspaceId,
      tenantState: "active",
      workspaceState: "active",
      planKey: null,
    });
    // Name and slug cross, because they are how a support request is matched
    // to a customer. Nothing else about the workspace does.
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        "closedAt",
        "name",
        "planKey",
        "region",
        "seats",
        "slug",
        "tenantState",
        "workspaceId",
        "workspaceState",
      ].sort(),
    );
  });

  // The usage counts moved to P8-T03b. The view written for them counted
  // zero, because `force row level security` applies to the table owner too
  // and a security-definer view over a content table is filtered like anybody
  // else. That is the floor working; the fix is a decision rather than a
  // detail, and it belongs with the screen the counts appear on. Migration
  // 0084 says the same in its own text.
});

describe("per-tenant usage, as a snapshot", () => {
  it("counts a real workspace properly, through its own tenant context", async () => {
    const wb = await workerDb();
    await grantOperator();
    await measureAllWorkspaces(wb.appPool);

    const [usage] = await readUsageAsOperator(
      wb.appPool,
      OPERATOR,
      workspaceId,
    );
    // A provisioned workspace has exactly one human member. The Coach and
    // the Champion are members too and are deliberately not counted, or every
    // workspace would look two people larger than it is.
    expect(usage).toMatchObject({
      workspaceId,
      memberCount: 1,
      goalCount: 0,
      checkInCount: 0,
      storageBytes: 0,
    });
    expect(usage?.measuredAt).toBeInstanceOf(Date);
  });

  it("is the fix for a view that measured zero, so zero has to be earned", async () => {
    // The reason this suite exists at all: the first attempt was a
    // security-definer view, and it reported zero members for a workspace
    // that had one. A zero reads as a quiet workspace, so the test that
    // matters is the one above finding a non-zero count. This one guards the
    // opposite direction: a workspace with nothing really does report zero
    // rather than the previous workspace's numbers.
    const wb = await workerDb();
    await grantOperator();
    const other = await createWorkspace(wb.appPool, {
      user: { id: OPERATOR, name: "Second Owner" },
    });
    await measureAllWorkspaces(wb.appPool);

    const all = await readUsageAsOperator(wb.appPool, OPERATOR);
    expect(all).toHaveLength(2);
    const second = all.find((row) => row.workspaceId === other.workspaceId);
    expect(second?.memberCount).toBe(1);
  });

  it("replaces the snapshot rather than appending to it", async () => {
    const wb = await workerDb();
    await grantOperator();
    await measureAllWorkspaces(wb.appPool);
    const first = await readUsageAsOperator(wb.appPool, OPERATOR, workspaceId);
    await measureAllWorkspaces(wb.appPool);
    const second = await readUsageAsOperator(wb.appPool, OPERATOR, workspaceId);

    expect(second).toHaveLength(1);
    expect(second[0]?.measuredAt.getTime()).toBeGreaterThanOrEqual(
      first[0]?.measuredAt.getTime() ?? 0,
    );
  });

  it("shows nothing to somebody with no grant", async () => {
    const wb = await workerDb();
    await measureAllWorkspaces(wb.appPool);
    await expect(readUsageAsOperator(wb.appPool, OPERATOR)).resolves.toEqual(
      [],
    );
  });

  it("carries no column a member wrote in", async () => {
    const wb = await workerDb();
    await grantOperator();
    await measureAllWorkspaces(wb.appPool);
    const [usage] = await readUsageAsOperator(
      wb.appPool,
      OPERATOR,
      workspaceId,
    );
    // Asserted on the column list rather than on a value, so adding a leaky
    // column fails this test rather than passing review.
    expect(Object.keys(usage ?? {}).sort()).toEqual([
      "checkInCount",
      "goalCount",
      "lastActivityAt",
      "measuredAt",
      "memberCount",
      "storageBytes",
      "workspaceId",
    ]);
  });
});
