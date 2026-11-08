import {
  connectionOptions,
  testDbEnv,
  workerDb,
} from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import type { BillingGateway } from "../src/billing/gateway.ts";
import { applyBillingEvent } from "../src/billing/webhook.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { setLifecycleAsOperator } from "../src/operator/lifecycle.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { PermanentDispatchError } from "../src/outbox/permanent.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  type ErasurePlan,
  eraseWorkspaces,
  planErasures,
} from "../src/tenancy/erasure.ts";
import {
  CLOUD_CLOSURE_RETENTION_KEY,
  CLOUD_ENABLED_KEY,
} from "../src/tenancy/index.ts";
import { joinWorkspaceForIdentity } from "../src/workspaces/directory-join.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Erasing a closed workspace (docs/design/workspace-erasure.md §10 and §11), as the
 * owner role the command runs as, against every table the schema has today.
 */

const ring = parseKeyRing({ current: newRootKey() });

const OWNER = "erase-owner";
const ELSEWHERE = "erase-elsewhere";
const OPERATOR = "erase-operator";
const GRANTER = "erase-granter";

let owner: pg.Pool;
let closing: string;
let staying: string;
const deletedPrefixes: string[] = [];
const deletedCustomers: string[] = [];

const settings = async (values: Record<string, unknown>) => {
  const wb = await workerDb();
  await writeSettings(
    wb.appPool,
    ring,
    Object.entries(values).map(([key, value]) => ({ key, value })),
  );
};

const closedDaysAgo = async (days: number) => {
  const wb = await workerDb();
  await setLifecycleAsOperator(wb.appPool, {
    workspaceId: closing,
    operatorUserId: OPERATOR,
    state: "closed",
    reason: "The customer asked.",
  });
  await wb.admin.query(
    "update tenants set closed_at = now() - make_interval(days => $2) where workspace_id = $1",
    [closing, days],
  );
};

/** The server's half: what the relay does with the rows the claim wrote. */
const deliverErasureRows = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    `select id, topic, payload, idempotency_key from outbox
      where topic in ('workspace.eraseFiles', 'billing.deleteCustomer')
        and delivered_at is null`,
  );
  for (const row of rows) {
    await dispatchOutbox(
      {
        topic: row.topic,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        attempts: 0,
      },
      {
        pool: wb.appPool,
        async deleteFiles(prefix) {
          deletedPrefixes.push(prefix);
        },
        billingFor: async () => ({
          provider: "stripe",
          endSubscription: async () => undefined,
          async deleteCustomer(ref) {
            deletedCustomers.push(ref);
          },
        }),
      },
    );
    await wb.admin.query(
      "update outbox set delivered_at = now() where id = $1",
      [row.id],
    );
  }
  return rows.length;
};

const ready = (plan: ErasurePlan) => {
  if (!plan.ready) {
    throw new Error(`expected a plan, got: ${plan.reason}`);
  }
  return plan;
};

const erase = async (options: { onlyId?: string } = {}) =>
  eraseWorkspaces(owner, ready(await planErasures(owner, options)), {
    ...options,
    waitMs: 0,
    sleep: async () => undefined,
  });

/** Every table holding `workspace_id`, counted and checksummed for one workspace. */
const fingerprint = async (workspaceId: string) => {
  const wb = await workerDb();
  const { rows: tables } = await wb.admin.query<{ name: string }>(
    `select table_name as name from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
      order by table_name`,
  );
  const result: Record<string, string> = {};
  for (const { name } of tables) {
    const { rows } = await wb.admin.query(
      `select count(*)::int as n,
              md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as sum
         from "${name}" t where workspace_id = $1`,
      [workspaceId],
    );
    result[name] = `${rows[0]?.n}:${rows[0]?.sum}`;
  }
  return result;
};

const users = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select id from users where id = any($1) order by id",
    [[OWNER, ELSEWHERE, OPERATOR, GRANTER]],
  );
  return rows.map((row) => row.id);
};

const receipts = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    `select action, payload from instance_audit_events
      where action in ('workspace.erasure_started', 'workspace.erased')
      order by seq`,
  );
  return rows as { action: string; payload: Record<string, unknown> }[];
};

beforeAll(async () => {
  const wb = await workerDb();
  owner = new pg.Pool({
    ...connectionOptions(wb.databaseName, testDbEnv.ownerRole),
    max: 2,
  });
});

afterAll(async () => {
  await owner.end();
  const wb = await workerDb();
  await wb.close();
});

beforeEach(async () => {
  deletedPrefixes.length = 0;
  deletedCustomers.length = 0;
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  for (const id of [OWNER, ELSEWHERE, OPERATOR, GRANTER]) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $1, $2)",
      [id, `${id}@example.com`],
    );
  }
  await settings({
    [CLOUD_ENABLED_KEY]: true,
    [CLOUD_CLOSURE_RETENTION_KEY]: 30,
  });
  await grantOperator(wb.appPool, {
    email: `${OPERATOR}@example.com`,
    grantedByEmail: `${GRANTER}@example.com`,
  });
  closing = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: OWNER } })
  ).workspaceId;
  staying = (
    await createWorkspace(wb.appPool, {
      user: { id: ELSEWHERE, name: ELSEWHERE },
    })
  ).workspaceId;
  for (const id of [ELSEWHERE, OPERATOR]) {
    await joinWorkspaceForIdentity(wb.appPool, {
      workspaceId: closing,
      user: { id, name: id },
      via: "sso",
    });
  }
  await wb.admin.query(
    `insert into billing_accounts (workspace_id, provider, customer_ref, subscription_ref, status)
     values ($1, 'stripe', 'cus_erase', 'sub_erase', 'active')`,
    [closing],
  );
  await wb.admin.query(
    "insert into sessions (id, token, user_id, expires_at, created_at, updated_at) values ('s-owner', 't-owner', $1, now() + interval '1 day', now(), now())",
    [OWNER],
  );
});

describe("what decides that nothing is erased (AC 1, 2, 13, 18)", () => {
  it("erases nothing while retention is 0, and says why", async () => {
    await settings({ [CLOUD_CLOSURE_RETENTION_KEY]: 0 });
    await closedDaysAgo(400);
    await expect(planErasures(owner)).resolves.toMatchObject({
      ready: false,
      reason: expect.stringMatching(/Retention is 0/),
    });
  });

  it("erases nothing on an instance that is not a cloud", async () => {
    await closedDaysAgo(400);
    await settings({ [CLOUD_ENABLED_KEY]: false });
    await expect(planErasures(owner)).resolves.toMatchObject({
      ready: false,
      reason: expect.stringMatching(/not a cloud/),
    });
  });

  it("keeps a workspace closed 29 days ago, and names it at 30", async () => {
    await closedDaysAgo(29);
    expect(ready(await planErasures(owner)).due).toEqual([]);
    const wb = await workerDb();
    await wb.admin.query(
      "update tenants set closed_at = now() - interval '30 days 1 minute' where workspace_id = $1",
      [closing],
    );
    expect(
      ready(await planErasures(owner)).due.map((one) => one.workspaceId),
    ).toEqual([closing]);
  });

  it("refuses before anything changes on a connection that cannot delete audit rows", async () => {
    await closedDaysAgo(31);
    const wb = await workerDb();
    await expect(planErasures(wb.appPool)).resolves.toMatchObject({
      ready: false,
      reason: expect.stringMatching(/cannot delete audit rows/),
    });
    const { rows } = await wb.admin.query(
      "select erasing_at from tenants where workspace_id = $1",
      [closing],
    );
    expect(rows[0]?.erasing_at).toBeNull();
  });
});

describe("erasing a workspace whose window has passed", () => {
  it("claims it at once: nobody can open or reopen it (AC 7)", async () => {
    await closedDaysAgo(31);
    await expect(erase()).resolves.toMatchObject([
      { workspaceId: closing, outcome: "waiting" },
    ]);
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId: closing,
          actor: { kind: "human", userId: OWNER },
        },
        "workspace.setLifecycle",
        { state: "active" },
      ),
    ).rejects.toThrow(/No such workspace/);
    await expect(
      setLifecycleAsOperator(wb.appPool, {
        workspaceId: closing,
        operatorUserId: OPERATOR,
        state: "active",
        reason: "Too late.",
      }),
    ).rejects.toThrow(/No such workspace/);
  });

  it("leaves no row anywhere, and another workspace exactly as it was (AC 8, 9, 10, 14)", async () => {
    await closedDaysAgo(31);
    const before = await fingerprint(staying);
    await erase();
    expect(await deliverErasureRows()).toBe(2);
    await expect(erase()).resolves.toEqual([
      { workspaceId: closing, outcome: "erased" },
    ]);

    const left = Object.entries(await fingerprint(closing)).filter(
      ([, value]) => !value.startsWith("0:"),
    );
    expect(left).toEqual([]);
    const wb = await workerDb();
    const { rows: workspace } = await wb.admin.query(
      "select 1 from workspaces where id = $1",
      [closing],
    );
    expect(workspace).toEqual([]);
    expect(await fingerprint(staying)).toEqual(before);

    // Only the person with nowhere else to go loses their account.
    expect(await users()).toEqual([ELSEWHERE, GRANTER, OPERATOR].sort());
    const { rows: sessions } = await wb.admin.query(
      "select 1 from sessions where user_id = $1",
      [OWNER],
    );
    expect(sessions).toEqual([]);
    const { rows: memberships } = await wb.admin.query(
      "select workspace_id from workspace_members where user_id = $1 and deleted_at is null",
      [ELSEWHERE],
    );
    expect(memberships.map((row) => row.workspace_id)).toEqual([staying]);

    expect(deletedPrefixes).toEqual([`${closing}/`]);
    expect(deletedCustomers).toEqual(["cus_erase"]);
  });

  it("writes a receipt that names nobody", async () => {
    await closedDaysAgo(31);
    await erase();
    await deliverErasureRows();
    await erase();
    const written = await receipts();
    expect(written.map((row) => row.action)).toEqual([
      "workspace.erasure_started",
      "workspace.erased",
    ]);
    const receipt = written[1]?.payload ?? {};
    expect(receipt).toMatchObject({
      workspaceId: closing,
      retentionDays: 30,
      windowSkipped: false,
      accounts: 1,
    });
    expect(receipt.slugSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(receipt.rows)).toBeGreaterThan(10);
    const text = JSON.stringify(receipt);
    for (const personal of [OWNER, ELSEWHERE, "example.com"]) {
      expect(text).not.toContain(personal);
    }
  });

  it("finishes with one receipt however often it is stopped (AC 11)", async () => {
    await closedDaysAgo(31);
    // Stopped after every batch: each run does one more and dies.
    let runs = 0;
    for (;;) {
      runs += 1;
      const plan = ready(await planErasures(owner));
      if (plan.due.length === 0) {
        break;
      }
      await eraseWorkspaces(owner, plan, {
        waitMs: 0,
        sleep: async () => undefined,
        interruptAfter: 1,
      });
      await deliverErasureRows();
      expect(runs).toBeLessThan(400);
    }
    expect(runs).toBeGreaterThan(5);
    expect(
      (await receipts()).filter((row) => row.action === "workspace.erased"),
    ).toHaveLength(1);
    const left = Object.entries(await fingerprint(closing)).filter(
      ([, value]) => !value.startsWith("0:"),
    );
    expect(left).toEqual([]);
  });

  it("acknowledges a webhook for it afterwards, and writes nothing (AC 15)", async () => {
    await closedDaysAgo(31);
    await erase();
    await deliverErasureRows();
    await erase();
    const wb = await workerDb();
    const gateway: Pick<BillingGateway, "provider" | "readSubscription"> = {
      provider: "stripe",
      readSubscription: async () => ({
        ref: "sub_erase",
        customerRef: "cus_erase",
        status: "canceled",
        priceId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        scheduledPriceId: null,
      }),
    };
    await expect(
      applyBillingEvent(wb.appPool, gateway, {
        kind: "subscription",
        eventRef: "evt_after",
        workspaceId: closing,
        subscriptionRef: "sub_erase",
      }),
    ).resolves.toBe("ignored");
  });
});

describe("the server's half", () => {
  it("fails rather than skips with nothing to delete files with, so erasure never claims what did not happen", async () => {
    const wb = await workerDb();
    await expect(
      dispatchOutbox(
        {
          topic: "workspace.eraseFiles",
          payload: { workspaceId: closing },
          idempotencyKey: "k",
          attempts: 0,
        },
        { pool: wb.appPool },
      ),
    ).rejects.toBeInstanceOf(PermanentDispatchError);
    await expect(
      dispatchOutbox(
        {
          topic: "billing.deleteCustomer",
          payload: {
            workspaceId: closing,
            provider: "stripe",
            customerRef: "cus_erase",
          },
          idempotencyKey: "k2",
          attempts: 0,
        },
        { pool: wb.appPool },
      ),
    ).rejects.toThrow(/No stripe billing/);
  });
});

describe("the audit trail during erasure (AC 12)", () => {
  it("refuses any role deleting a live workspace's audit rows", async () => {
    const client = await owner.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [
        staying,
      ]);
      await expect(
        client.query("delete from audit_events where workspace_id = $1", [
          staying,
        ]),
      ).rejects.toThrow(/append-only/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("refuses the server's role even for a workspace being erased", async () => {
    await closedDaysAgo(31);
    await erase();
    const wb = await workerDb();
    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [
        closing,
      ]);
      await expect(
        client.query("delete from audit_events where workspace_id = $1", [
          closing,
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});

describe("erasing one workspace now (AC 16)", () => {
  it("erases a closed workspace inside its window, and the receipt says so", async () => {
    await closedDaysAgo(1);
    await erase({ onlyId: closing });
    await deliverErasureRows();
    await expect(erase({ onlyId: closing })).resolves.toEqual([
      { workspaceId: closing, outcome: "erased" },
    ]);
    expect((await receipts()).at(-1)?.payload).toMatchObject({
      windowSkipped: true,
    });
  });

  it("refuses a workspace that is not closed", async () => {
    await expect(
      planErasures(owner, { onlyId: staying }),
    ).resolves.toMatchObject({
      ready: false,
      reason: expect.stringMatching(/not a closed workspace/),
    });
  });
});
