import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { setPlanAsOperator } from "../src/operator/plans.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  CLOUD_ENABLED_KEY,
  isCloudEnabled,
  readPlans,
  readTenant,
  seatState,
} from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";
import { isRegistrationOpen } from "../src/workspaces/registration.ts";

/**
 * The setups one release has to keep working (PLAN.md §5.2).
 *
 * **One row per setup, and a change that breaks any of them is a defect.** The
 * cloud flag, the plan catalogue and the registration policy are independent
 * switches, so nothing else proves that a change made for a paying cloud left
 * a university's single workspace alone, or the other way round. Each later
 * capability adds its own claim to the row it changes.
 *
 * Settings are written the way an operator's are, through `writeSettings`, so
 * this reads what a deployment would read.
 */

const ring = parseKeyRing({ current: newRootKey() });

const FOUNDER = "profile-founder";
const OPERATOR = "profile-operator";

/** Another provider's own catalogue. Nothing in the product names these. */
const PROVIDER_PLANS = [
  { key: "starter", name: "Starter", seats: 2, aiMonthlyUsd: null },
];

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const applySetup = async (settings: Record<string, unknown>) => {
  const wb = await workerDb();
  await writeSettings(
    wb.appPool,
    ring,
    Object.entries(settings).map(([key, value]) => ({ key, value })),
  );
};

const addPeople = async (workspaceId: string, count: number) => {
  const wb = await workerDb();
  for (let index = 0; index < count; index += 1) {
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'human', 'active')",
      [newId(), workspaceId, `Person ${index}`],
    );
  }
};

const firstWorkspace = async () => {
  const wb = await workerDb();
  return (
    await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    })
  ).workspaceId;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await Promise.all([seedUser(FOUNDER), seedUser(OPERATOR)]);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("one organisation with one workspace: every switch at its default", () => {
  it("is not a cloud, and registration closes behind the first account", async () => {
    const wb = await workerDb();
    await expect(isCloudEnabled(wb.appPool)).resolves.toBe(false);
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(false);
  });

  it("writes no tenant record and has no plans", async () => {
    const wb = await workerDb();
    const workspaceId = await firstWorkspace();
    await expect(readTenant(wb.appPool, workspaceId)).resolves.toBeUndefined();
    await expect(readPlans(wb.appPool)).resolves.toEqual([]);
  });

  it("never limits seats", async () => {
    const wb = await workerDb();
    const workspaceId = await firstWorkspace();
    await addPeople(workspaceId, 30);
    await expect(seatState(wb.appPool, workspaceId)).resolves.toMatchObject({
      limit: null,
      used: 31,
      full: false,
    });
  });
});

describe.each([
  ["a group of companies", "company_domains"],
  ["one organisation with several workspaces", "invite_only"],
])("%s: the cloud flag on, no plans", (_setup, policy) => {
  beforeEach(async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "registration.policy": policy,
    });
  });

  it("gives each workspace a tenant record, so the console can list it", async () => {
    const wb = await workerDb();
    const workspaceId = await firstWorkspace();
    await expect(readTenant(wb.appPool, workspaceId)).resolves.toMatchObject({
      state: "active",
      planKey: null,
      seats: null,
    });
  });

  it("never limits seats, because self-hosting never does", async () => {
    const wb = await workerDb();
    const workspaceId = await firstWorkspace();
    await addPeople(workspaceId, 30);
    await expect(seatState(wb.appPool, workspaceId)).resolves.toMatchObject({
      limit: null,
      full: false,
    });
    await expect(readPlans(wb.appPool)).resolves.toEqual([]);
  });

  it("keeps the registration policy it chose, despite the flag", async () => {
    const wb = await workerDb();
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(false);
  });
});

describe("a cloud run by a provider: the flag on, its own plans", () => {
  beforeEach(async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "cloud.plans": PROVIDER_PLANS,
    });
  });

  it("stays open to sign-ups however many people have arrived", async () => {
    const wb = await workerDb();
    await firstWorkspace();
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(true);
  });

  it("offers the provider's own catalogue", async () => {
    const wb = await workerDb();
    await expect(readPlans(wb.appPool)).resolves.toEqual(PROVIDER_PLANS);
  });

  it("does not let an administrator take a plan for nothing", async () => {
    const wb = await workerDb();
    const workspaceId = await firstWorkspace();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: FOUNDER },
        },
        "workspace.changePlan",
        { planKey: "starter" },
      ),
    ).rejects.toThrow(/through billing/);
    await expect(readTenant(wb.appPool, workspaceId)).resolves.toMatchObject({
      planKey: null,
    });
  });

  it("applies a plan's seat limit once an operator sets the plan", async () => {
    const wb = await workerDb();
    const workspaceId = await firstWorkspace();
    await grantOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      grantedByEmail: `${FOUNDER}@example.com`,
    });
    await setPlanAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      planKey: "starter",
      reason: "Signed up for Starter",
    });
    await addPeople(workspaceId, 1);
    await expect(seatState(wb.appPool, workspaceId)).resolves.toMatchObject({
      limit: 2,
      used: 2,
      full: true,
    });
  });
});
