import { workerDb } from "@openokr/test-support/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { planLimitsFor, readPlans } from "../src/tenancy/plans.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Where an operator's plan catalogue comes from (UAT BUG-022).
 *
 * \`cloud.plans\` was read from the settings table only, and nothing wrote it
 * or said how to, so a cloud instance offered Free and nothing else.
 * OPENOKR_CLOUD_PLANS now bootstraps it, and a stored catalogue still wins.
 */
const TEAM = [{ key: "team", name: "Team", seats: 20 }];

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings where key = 'cloud.plans'");
});

afterEach(() => {
  delete process.env.OPENOKR_CLOUD_PLANS;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the plan catalogue", () => {
  it("is empty with nothing configured", async () => {
    const wb = await workerDb();
    expect(await readPlans(wb.appPool)).toEqual([]);
  });

  it("bootstraps from OPENOKR_CLOUD_PLANS", async () => {
    const wb = await workerDb();
    process.env.OPENOKR_CLOUD_PLANS = JSON.stringify(TEAM);
    expect(await readPlans(wb.appPool)).toEqual(TEAM);
  });

  it("reads a malformed variable as no catalogue rather than failing", async () => {
    const wb = await workerDb();
    process.env.OPENOKR_CLOUD_PLANS = "[{not json";
    expect(await readPlans(wb.appPool)).toEqual([]);
  });

  it("prefers a stored catalogue over the variable", async () => {
    const wb = await workerDb();
    process.env.OPENOKR_CLOUD_PLANS = JSON.stringify(TEAM);
    const stored = [{ key: "small", name: "Small", seats: 5 }];
    await wb.admin.query(
      "insert into system_settings (key, value) values ('cloud.plans', $1::jsonb)",
      [JSON.stringify(stored)],
    );
    expect(await readPlans(wb.appPool)).toEqual(stored);
  });
});

describe("a plan's own limits (plan 0.7.0 P5)", () => {
  const WITH_LIMITS = [
    {
      key: "scale",
      name: "Scale",
      seats: 200,
      limits: { actionsPerMinute: 1200, concurrentActions: 8 },
    },
  ];

  it("are read with the plan", async () => {
    const wb = await workerDb();
    process.env.OPENOKR_CLOUD_PLANS = JSON.stringify(WITH_LIMITS);
    expect(await readPlans(wb.appPool)).toEqual(WITH_LIMITS);
  });

  it("are refused below the instance settings' floors, so no plan can set an outage", async () => {
    const wb = await workerDb();
    process.env.OPENOKR_CLOUD_PLANS = JSON.stringify([
      { key: "tiny", name: "Tiny", seats: 5, limits: { actionsPerMinute: 10 } },
    ]);
    expect(await readPlans(wb.appPool)).toEqual([]);
  });

  it("are a workspace's own when its tenant is on that plan, and nothing otherwise", async () => {
    const wb = await workerDb();
    await wb.admin.query("delete from users where id = 'plan-limits-owner'");
    await wb.admin.query(
      "insert into users (id, name, email) values ('plan-limits-owner', 'Owner', 'plan-limits@example.com')",
    );
    const { workspaceId } = await provisionWorkspaceForUser(wb.appPool, {
      id: "plan-limits-owner",
      name: "Owner",
    });
    process.env.OPENOKR_CLOUD_PLANS = JSON.stringify(WITH_LIMITS);
    expect(await planLimitsFor(wb.appPool, workspaceId)).toBeNull();

    await wb.admin.query(
      `insert into tenants (workspace_id, plan_key, seats, region)
       values ($1, 'scale', 200, 'test')
       on conflict (workspace_id) do update set plan_key = 'scale'`,
      [workspaceId],
    );
    expect(await planLimitsFor(wb.appPool, workspaceId)).toEqual({
      actionsPerMinute: 1200,
      concurrentActions: 8,
    });
  });
});
