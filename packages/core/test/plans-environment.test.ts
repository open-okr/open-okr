import { workerDb } from "@openokr/test-support/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPlans } from "../src/tenancy/plans.ts";

/**
 * Where an operator's plan catalogue comes from (UAT BUG-022).
 *
 * \`cloud.plans\` was read from the settings table only, and nothing wrote it
 * or said how to, so a cloud instance offered Free and nothing else.
 * OPENOKR_CLOUD_PLANS now bootstraps it, and a stored catalogue still wins.
 */
const TEAM = [{ key: "team", name: "Team", seats: 20, aiMonthlyUsd: 50 }];

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
    const stored = [
      { key: "small", name: "Small", seats: 5, aiMonthlyUsd: null },
    ];
    await wb.admin.query(
      "insert into system_settings (key, value) values ('cloud.plans', $1::jsonb)",
      [JSON.stringify(stored)],
    );
    expect(await readPlans(wb.appPool)).toEqual(stored);
  });
});
