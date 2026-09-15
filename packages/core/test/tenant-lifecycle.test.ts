import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
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
 * `docs/design/p8-t01a-tenant-lifecycle.md` §3 and §6).
 *
 * The claim under test is that the lifecycle adds no second enforcement
 * point, and that the sweep destroys nothing until somebody sets a number.
 */

const ring = parseKeyRing({ current: newRootKey() });
const USER = "lifecycle-owner";

let workspaceId: string;

const setSetting = async (key: string, value: unknown) => {
  const wb = await workerDb();
  await writeSettings(wb.appPool, ring, [{ key, value }]);
};

const move = async (state: "active" | "suspended" | "closed") => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: USER } },
    "workspace.setLifecycle",
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
  const provisioned = await createWorkspace(wb.appPool, {
    user: { id: USER, name: "The Owner" },
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the lifecycle projects onto the state the freeze overlay reads", () => {
  it("makes a suspended workspace read-only", async () => {
    await move("suspended");
    expect(await workspaceState()).toBe("read_only");
    await expect(
      readTenant((await workerDb()).appPool, workspaceId),
    ).resolves.toMatchObject({ state: "suspended", closedAt: null });
  });

  it("makes a closed workspace frozen, and stamps the instant", async () => {
    await move("closed");
    expect(await workspaceState()).toBe("frozen");
    const tenant = await readTenant((await workerDb()).appPool, workspaceId);
    expect(tenant?.state).toBe("closed");
    expect(tenant?.closedAt).toBeInstanceOf(Date);
  });

  it("clears the closure instant on the way back to active", async () => {
    // Migration 0082's check constraint refuses a closed tenant with no
    // instant and an open one with one, so reopening has to clear it or the
    // write fails at the database.
    await move("closed");
    await move("active");
    const tenant = await readTenant((await workerDb()).appPool, workspaceId);
    expect(tenant).toMatchObject({ state: "active", closedAt: null });
    expect(await workspaceState()).toBe("active");
  });

  it("can lift a suspension it is itself suspended by", async () => {
    // The whole reason `workspace.setState` is on the freeze overlay's
    // recovery list, applied to the action beside it. Without this, a cloud
    // workspace could be suspended and never reactivated.
    await move("suspended");
    await expect(move("active")).resolves.toMatchObject({ state: "active" });
  });

  it("refuses an ordinary write while suspended, in the overlay and not in new code", async () => {
    const wb = await workerDb();
    await move("suspended");
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

describe("the closure retention sweep", () => {
  const longAfter = () => new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);

  it("touches nothing while retention is unset, however long ago the closure was", async () => {
    const wb = await workerDb();
    await move("closed");
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
    await move("closed");
    const result = await sweepClosedTenants(wb.appPool, { now: longAfter() });
    expect(result.reason).toBe("swept");
    expect(result.due.map((row) => row.workspaceId)).toEqual([workspaceId]);
  });

  it("leaves a workspace closed inside its window alone", async () => {
    const wb = await workerDb();
    await setSetting(CLOUD_CLOSURE_RETENTION_KEY, 90);
    await move("closed");
    const result = await sweepClosedTenants(wb.appPool);
    expect(result.due).toEqual([]);
  });

  it("never names a workspace that is merely suspended", async () => {
    // Suspension is reversible and a suspended customer is still a customer.
    // Only a closure starts the clock.
    const wb = await workerDb();
    await setSetting(CLOUD_CLOSURE_RETENTION_KEY, 1);
    await move("suspended");
    const result = await sweepClosedTenants(wb.appPool, { now: longAfter() });
    expect(result.due).toEqual([]);
  });
});
