import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  adoptWorkspacesAsOperator,
  countWorkspacesAwaitingAdoption,
} from "../src/operator/adopt.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { readTenant } from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Adopting from the console (Q-9, plan 0.8.1).
 *
 * Turning the cloud flag on after workspaces exist left the console reading
 * "0 tenants" until the hourly adopt ran. The console now says how many wait
 * and adopts them on the operator's word, with the same adopt as
 * `pnpm cloud:adopt` (`hosting-profiles.test.ts` proves that one), and one
 * instance audit row naming the operator.
 */

const OPERATOR = "adopt-operator";
const GRANTER = "adopt-granter";
const FIRST = "adopt-first";
const SECOND = "adopt-second";

const ids: Record<string, string> = {};

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const cloud = async (on: boolean) => {
  const wb = await workerDb();
  if (on) {
    await wb.admin.query(
      "insert into system_settings (key, value) values ('cloud.enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value",
    );
  } else {
    await wb.admin.query(
      "delete from system_settings where key = 'cloud.enabled'",
    );
  }
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  for (const id of [OPERATOR, GRANTER, FIRST, SECOND]) {
    await seedUser(id);
  }
  // Two workspaces from before the flag, so neither has a tenant record.
  for (const owner of [FIRST, SECOND]) {
    ids[owner] = (
      await createWorkspace(wb.appPool, { user: { id: owner, name: owner } })
    ).workspaceId;
  }
  await grantOperator(wb.appPool, {
    email: `${OPERATOR}@example.com`,
    grantedByEmail: `${GRANTER}@example.com`,
  });
  await cloud(true);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what waits", () => {
  it("counts the live workspaces with no tenant record", async () => {
    const wb = await workerDb();
    await expect(
      countWorkspacesAwaitingAdoption(wb.appPool, OPERATOR),
    ).resolves.toBe(2);

    await wb.admin.query(
      "insert into tenants (workspace_id, state, region) values ($1, 'active', 'local')",
      [ids[FIRST]],
    );
    await expect(
      countWorkspacesAwaitingAdoption(wb.appPool, OPERATOR),
    ).resolves.toBe(1);
  });

  it("is nothing on a truly empty instance", async () => {
    const wb = await workerDb();
    await wb.admin.query("update workspaces set deleted_at = now()");
    await expect(
      countWorkspacesAwaitingAdoption(wb.appPool, OPERATOR),
    ).resolves.toBe(0);
  });

  it("is nothing with the flag off, where adopting would do nothing", async () => {
    const wb = await workerDb();
    await cloud(false);
    await expect(
      countWorkspacesAwaitingAdoption(wb.appPool, OPERATOR),
    ).resolves.toBe(0);
  });

  it("is for an operator only", async () => {
    const wb = await workerDb();
    await expect(
      countWorkspacesAwaitingAdoption(wb.appPool, FIRST),
    ).rejects.toThrow(/No such page/);
  });
});

describe("Adopt now", () => {
  it("adopts every waiting workspace, once, with one instance audit row", async () => {
    const wb = await workerDb();
    await expect(
      adoptWorkspacesAsOperator(wb.appPool, { operatorUserId: OPERATOR }),
    ).resolves.toBe(2);

    for (const owner of [FIRST, SECOND]) {
      await expect(
        readTenant(wb.appPool, ids[owner] as string),
      ).resolves.toMatchObject({ state: "active", planKey: null });
    }
    await expect(
      countWorkspacesAwaitingAdoption(wb.appPool, OPERATOR),
    ).resolves.toBe(0);

    // Each workspace's own trail says it was adopted, as the command's does.
    const adopted = await wb.admin.query(
      "select workspace_id from audit_events where action = 'workspace.adopted'",
    );
    expect(adopted.rows).toHaveLength(2);

    const instance = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from instance_audit_events where action = 'operator.workspaces_adopted'",
    );
    expect(instance.rows).toHaveLength(1);
    expect(instance.rows[0]?.payload).toEqual({
      operatorUserId: OPERATOR,
      adopted: 2,
    });

    // A second press finds nothing left, and says so in the trail too.
    await expect(
      adoptWorkspacesAsOperator(wb.appPool, { operatorUserId: OPERATOR }),
    ).resolves.toBe(0);
  });

  it("is refused to anybody without a live grant, and adopts nothing", async () => {
    const wb = await workerDb();
    await expect(
      adoptWorkspacesAsOperator(wb.appPool, { operatorUserId: FIRST }),
    ).rejects.toThrow(/No such page/);
    await expect(
      readTenant(wb.appPool, ids[FIRST] as string),
    ).resolves.toBeUndefined();
    const instance = await wb.admin.query(
      "select 1 from instance_audit_events where action = 'operator.workspaces_adopted'",
    );
    expect(instance.rows).toHaveLength(0);
  });
});
