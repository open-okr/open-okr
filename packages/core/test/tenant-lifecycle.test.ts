import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction, getAction } from "../src/actions/registry.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { setLifecycleAsOperator } from "../src/operator/lifecycle.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  CLOUD_CLOSURE_RETENTION_KEY,
  CLOUD_ENABLED_KEY,
  readTenant,
  sweepClosedTenants,
} from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * The tenant lifecycle and the retention sweep (P8-T02c, design in
 * `docs/design/tenant-lifecycle.md` §3 and §6).
 *
 * The claim under test is that the lifecycle adds no second enforcement
 * point, and that the sweep destroys nothing until somebody sets a number.
 */

const ring = parseKeyRing({ current: newRootKey() });
const USER = "lifecycle-owner";
const OPERATOR = "lifecycle-operator";

let workspaceId: string;
let slug: string;

const setSetting = async (key: string, value: unknown) => {
  const wb = await workerDb();
  await writeSettings(wb.appPool, ring, [{ key, value }]);
};

/** The workspace's own administrator, through the action every surface reaches. */
const asAdmin = async (
  state: "active" | "suspended" | "closed",
  confirmSlug?: string,
) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: USER } },
    "workspace.setLifecycle",
    { state, ...(confirmSlug === undefined ? {} : { confirmSlug }) },
  );
};

/** The provider's operator, through the console's own door. */
const asOperator = async (state: "active" | "suspended" | "closed") => {
  const wb = await workerDb();
  return setLifecycleAsOperator(wb.appPool, {
    workspaceId,
    operatorUserId: OPERATOR,
    state,
    reason: "A test of the lifecycle.",
  });
};

/** Closing the way an administrator does it: typing the workspace's address. */
const close = () => asAdmin("closed", slug);

const setState = async (state: "active" | "read_only" | "frozen") => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: USER } },
    "workspace.setState",
    { state },
  );
};

const workspaceState = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select state from workspaces where id = $1",
    [workspaceId],
  );
  return rows[0]?.state as string;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await setSetting(CLOUD_ENABLED_KEY, true);
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [USER, "The Owner", "lifecycle@example.com"],
  );
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OPERATOR, "The Operator", "operator@provider.example"],
  );
  await wb.admin.query("delete from instance_operators");
  await grantOperator(wb.appPool, {
    email: "operator@provider.example",
    grantedByEmail: "lifecycle@example.com",
  });
  const provisioned = await createWorkspace(wb.appPool, {
    user: { id: USER, name: "The Owner" },
  });
  workspaceId = provisioned.workspaceId;
  slug = provisioned.slug;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the lifecycle projects onto the state the freeze overlay reads", () => {
  it("makes a suspended workspace read-only", async () => {
    await asOperator("suspended");
    expect(await workspaceState()).toBe("read_only");
    await expect(
      readTenant((await workerDb()).appPool, workspaceId),
    ).resolves.toMatchObject({ state: "suspended", closedAt: null });
  });

  it("makes a closed workspace frozen, and stamps the instant", async () => {
    await close();
    expect(await workspaceState()).toBe("frozen");
    const tenant = await readTenant((await workerDb()).appPool, workspaceId);
    expect(tenant?.state).toBe("closed");
    expect(tenant?.closedAt).toBeInstanceOf(Date);
  });

  it("clears the closure instant on the way back to active", async () => {
    // Migration 0082's check constraint refuses a closed tenant with no
    // instant and an open one with one, so reopening has to clear it or the
    // write fails at the database.
    await close();
    await asOperator("active");
    const tenant = await readTenant((await workerDb()).appPool, workspaceId);
    expect(tenant).toMatchObject({ state: "active", closedAt: null });
    expect(await workspaceState()).toBe("active");
  });

  it("can lift a suspension it is itself suspended by", async () => {
    // The whole reason `workspace.setLifecycle` is on the freeze overlay's
    // recovery list. Without this, a cloud workspace could be suspended and
    // never reactivated.
    await asOperator("suspended");
    await expect(asOperator("active")).resolves.toMatchObject({
      state: "active",
    });
  });

  it("refuses an ordinary write while suspended, in the overlay and not in new code", async () => {
    const wb = await workerDb();
    await asOperator("suspended");
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: USER },
        },
        "workspace.rename",
        { name: "A new name" },
      ),
    ).rejects.toThrow(/read-only/i);
  });
});

describe("what a workspace's own administrator may move (workspace-erasure.md §3)", () => {
  it("closes it by typing its address", async () => {
    await expect(close()).resolves.toMatchObject({ state: "closed" });
    expect(await workspaceState()).toBe("frozen");
  });

  it("changes nothing when the address typed is not this one", async () => {
    await expect(asAdmin("closed", `${slug}-not`)).rejects.toThrow(
      /does not match/,
    );
    await expect(asAdmin("closed")).rejects.toThrow(/does not match/);
    expect(await workspaceState()).toBe("active");
  });

  it("closes one billing made read-only, which it then cannot reopen", async () => {
    // Closing is how somebody who stopped paying leaves. Reopening it would be
    // the way out of paying, so that is the provider's.
    const wb = await workerDb();
    await wb.admin.query(
      `insert into billing_accounts
         (workspace_id, provider, customer_ref, suspended_by_billing)
       values ($1, 'stripe', 'cus_lifecycle', true)`,
      [workspaceId],
    );
    await asOperator("suspended");
    await expect(close()).resolves.toMatchObject({ state: "closed" });
    await expect(asAdmin("active")).rejects.toThrow(/provider/);
  });

  it("cannot close one the provider suspended, which may be a legal hold", async () => {
    await asOperator("suspended");
    await expect(close()).rejects.toThrow(/provider/);
    const tenant = await readTenant((await workerDb()).appPool, workspaceId);
    expect(tenant?.state).toBe("suspended");
  });

  it("cannot suspend it: that is the provider's", async () => {
    await expect(asAdmin("suspended")).rejects.toThrow(/provider/);
    expect(await workspaceState()).toBe("active");
  });

  it("cannot lift a suspension through the lifecycle", async () => {
    await asOperator("suspended");
    await expect(asAdmin("active")).rejects.toThrow(/provider/);
    expect(await workspaceState()).toBe("read_only");
  });

  it("cannot lift a suspension through the workspace state either", async () => {
    await asOperator("suspended");
    await expect(setState("active")).rejects.toThrow(/suspended/);
    expect(await workspaceState()).toBe("read_only");
  });

  it("cannot reopen a closure through the workspace state", async () => {
    await close();
    await expect(setState("active")).rejects.toThrow(/closed/);
    expect(await workspaceState()).toBe("frozen");
    const tenant = await readTenant((await workerDb()).appPool, workspaceId);
    expect(tenant?.state).toBe("closed");
  });

  it("still freezes and unfreezes an active workspace itself", async () => {
    await setState("frozen");
    await expect(setState("active")).resolves.toMatchObject({
      state: "active",
    });
  });

  it("is not something an agent's tools offer, and a token needs the destructive scope", () => {
    const action = getAction("workspace.setLifecycle");
    expect(action?.agentSurface).toBe(false);
    expect(action?.safety).toBe("destructive");
  });
});

describe("the closure retention sweep", () => {
  const longAfter = () => new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);

  it("touches nothing while retention is unset, however long ago the closure was", async () => {
    const wb = await workerDb();
    await close();
    const result = await sweepClosedTenants(wb.appPool, { now: longAfter() });
    expect(result).toMatchObject({ reason: "retention_off", due: [] });
  });

  it("says it is not a cloud rather than pretending it swept", async () => {
    const wb = await workerDb();
    await setSetting(CLOUD_ENABLED_KEY, false);
    const result = await sweepClosedTenants(wb.appPool);
    expect(result.reason).toBe("not_a_cloud");
  });

  it("names a workspace past its window once somebody sets a number", async () => {
    const wb = await workerDb();
    await setSetting(CLOUD_CLOSURE_RETENTION_KEY, 90);
    await close();
    const result = await sweepClosedTenants(wb.appPool, { now: longAfter() });
    expect(result.reason).toBe("swept");
    expect(result.due.map((row) => row.workspaceId)).toEqual([workspaceId]);
  });

  it("leaves a workspace closed inside its window alone", async () => {
    const wb = await workerDb();
    await setSetting(CLOUD_CLOSURE_RETENTION_KEY, 90);
    await close();
    const result = await sweepClosedTenants(wb.appPool);
    expect(result.due).toEqual([]);
  });

  it("never names a workspace that is merely suspended", async () => {
    // Suspension is reversible and a suspended customer is still a customer.
    // Only a closure starts the clock.
    const wb = await workerDb();
    await setSetting(CLOUD_CLOSURE_RETENTION_KEY, 1);
    await asOperator("suspended");
    const result = await sweepClosedTenants(wb.appPool, { now: longAfter() });
    expect(result.due).toEqual([]);
  });
});
