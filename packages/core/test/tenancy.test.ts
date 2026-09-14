import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getInstanceSetting,
  INSTANCE_SETTINGS,
} from "../src/secrets/instance-registry.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  CLOUD_CLOSURE_RETENTION_KEY,
  CLOUD_ENABLED_KEY,
  CLOUD_REGION_KEY,
  readTenant,
  resolveCloudTenancy,
} from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * The tenant record (P8-T02a, design in
 * `docs/design/p8-t01a-tenant-lifecycle.md`).
 *
 * The design's central claim is that the tenant is a sidecar: a self-hosted
 * instance has no row, and the product behaves identically either way. Most
 * of what is below exists to hold that claim rather than to exercise a
 * feature, because the failure it guards against is invisible until a
 * self-hosted instance meets a null.
 */

const ring = parseKeyRing({ current: newRootKey() });

/**
 * `users` is Better Auth's table rather than a business one, so the
 * test-support factory has no builder for it and every core suite seeds it
 * the same way. Following that rather than inventing a second shape.
 */
const user = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, `Person ${id}`, `${id}@example.com`],
  );
  return { id, name: `Person ${id}` };
};

/** Turns the cloud on for one test, the way a deployment would. */
const enableCloud = async (region = "ap-southeast-1") => {
  const wb = await workerDb();
  await writeSettings(wb.appPool, ring, [
    { key: CLOUD_ENABLED_KEY, value: true },
    { key: CLOUD_REGION_KEY, value: region },
  ]);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the three cloud settings", () => {
  it("declares every one of them in the instance registry", () => {
    for (const key of [
      CLOUD_ENABLED_KEY,
      CLOUD_REGION_KEY,
      CLOUD_CLOSURE_RETENTION_KEY,
    ]) {
      expect(
        INSTANCE_SETTINGS.find((setting) => setting.key === key),
        `${key} is not in the instance registry`,
      ).toBeDefined();
    }
  });

  it("defaults the cloud off, so a self-hosted instance is one by doing nothing", () => {
    expect(getInstanceSetting(CLOUD_ENABLED_KEY)?.fallback).toBe(false);
  });

  it("defaults closure retention to zero, which means never erase", () => {
    // P7-T08c's rule, applied to something much larger than a delivery log:
    // "not configured" must never mean "delete everything". A number here
    // would erase closed workspaces on the first sweep after an upgrade, on
    // every instance that never chose one.
    expect(getInstanceSetting(CLOUD_CLOSURE_RETENTION_KEY)?.fallback).toBe(0);
  });

  it("resolves to off and unset on a fresh instance", async () => {
    const wb = await workerDb();
    const resolved = await resolveCloudTenancy(wb.appPool);
    expect(resolved.enabled).toBe(false);
  });

  it("resolves the region a deployment set", async () => {
    await enableCloud("eu-west-1");
    const wb = await workerDb();
    const resolved = await resolveCloudTenancy(wb.appPool);
    expect(resolved).toMatchObject({ enabled: true, region: "eu-west-1" });
  });
});

describe("provisioning on a self-hosted instance", () => {
  it("writes no tenant row at all", async () => {
    const wb = await workerDb();
    const provisioned = await createWorkspace(wb.appPool, {
      user: await user("self-host-1"),
    });

    const { rows } = await wb.admin.query("select * from tenants");
    expect(rows).toHaveLength(0);
    // And the workspace itself is complete, which is the half that would
    // still pass if the tenant row were the only thing missing.
    expect(provisioned.workspaceId).toBeTruthy();
  });

  it("reads back as no tenant rather than as an error", async () => {
    const wb = await workerDb();
    const provisioned = await createWorkspace(wb.appPool, {
      user: await user("self-host-2"),
    });

    // The product path never asks, but the tenancy module's own reader has
    // to answer for a workspace with no row without throwing, or every
    // caller learns to wrap it.
    await expect(
      readTenant(wb.appPool, provisioned.workspaceId),
    ).resolves.toBeUndefined();
  });
});

describe("provisioning on a cloud instance", () => {
  it("writes exactly one tenant row, on the free tier, in the named region", async () => {
    await enableCloud("ap-southeast-1");
    const wb = await workerDb();
    const provisioned = await createWorkspace(wb.appPool, {
      user: await user("cloud-1"),
    });

    // Null plan is the free tier, so the free tier needs no catalogue row,
    // and null seats is unlimited, so a cloud signup is never refused for a
    // plan nobody has chosen yet. Both are asserted rather than assumed.
    const tenant = await readTenant(wb.appPool, provisioned.workspaceId);
    expect(tenant).toMatchObject({
      workspaceId: provisioned.workspaceId,
      state: "active",
      region: "ap-southeast-1",
      planKey: null,
      seats: null,
    });
  });

  it("gives every provisioned workspace a tenant, with none left behind", async () => {
    await enableCloud();
    const wb = await workerDb();
    for (const id of ["cloud-a", "cloud-b", "cloud-c"]) {
      await createWorkspace(wb.appPool, { user: await user(id) });
    }

    const workspaces = await wb.admin.query("select count(*) from workspaces");
    const tenants = await wb.admin.query("select count(*) from tenants");
    expect(tenants.rows[0].count).toBe(workspaces.rows[0].count);
  });

  it("commits the tenant with the workspace, so neither can exist without the other", async () => {
    await enableCloud();
    const wb = await workerDb();
    const provisioned = await createWorkspace(wb.appPool, {
      user: await user("cloud-atomic"),
    });

    // The design's claim is that there is no between. The evidence available
    // to a test is that the tenant's row shares the workspace's creation
    // instant, because both were written by one transaction.
    const { rows } = await wb.admin.query(
      `select w.created_at as workspace_at, t.created_at as tenant_at
         from workspaces w join tenants t on t.workspace_id = w.id
        where w.id = $1`,
      [provisioned.workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_at).toEqual(rows[0].workspace_at);
  });
});

describe("the tenant floor applies to the tenant table itself", () => {
  it("returns zero rows for another workspace", async () => {
    await enableCloud();
    const wb = await workerDb();
    const mine = await createWorkspace(wb.appPool, {
      user: await user("floor-1"),
    });
    const theirs = await createWorkspace(wb.appPool, {
      user: await user("floor-2"),
    });

    // Read with my workspace set, asking for theirs. The policy is what
    // answers, not a filter in the reader.
    await expect(
      readTenant(wb.appPool, theirs.workspaceId, {
        asWorkspaceId: mine.workspaceId,
      }),
    ).resolves.toBeUndefined();

    // And my own is still readable, so the test above is not passing because
    // the reader is broken for everybody.
    await expect(
      readTenant(wb.appPool, mine.workspaceId, {
        asWorkspaceId: mine.workspaceId,
      }),
    ).resolves.toMatchObject({ workspaceId: mine.workspaceId });
  });

  it("never yields a row on a connection with no workspace applied", async () => {
    await enableCloud();
    const wb = await workerDb();
    await createWorkspace(wb.appPool, { user: await user("floor-3") });

    // **Two behaviours, both fail-closed, and which one you get depends on
    // the connection's history.** This is repo-wide and predates this table:
    // every tenant policy compares against
    // `current_setting('app.workspace_id', true)::uuid`.
    //
    //   - A connection that has never carried a workspace reads the setting
    //     as NULL, the cast is fine, and the comparison yields no rows.
    //   - A pooled connection that has already served a tenant-scoped
    //     transaction reads it as the empty string, because `SET LOCAL`
    //     reverts to the session value at commit and a custom setting that
    //     was never set at session level is ''. `''::uuid` then raises.
    //
    // Neither leaks a row, so the floor holds either way. The test asserts
    // the property that matters rather than one of the two shapes, because
    // asserting a shape would make it fail on a pool that happened to hand
    // back a different connection.
    const outcome = await wb.appPool
      .query("select * from tenants")
      .then((result) => ({ kind: "rows" as const, rows: result.rows }))
      .catch((error: Error) => ({ kind: "refused" as const, error }));

    if (outcome.kind === "rows") {
      expect(outcome.rows).toHaveLength(0);
    } else {
      expect(outcome.error.message).toContain(
        "invalid input syntax for type uuid",
      );
    }
  });
});
