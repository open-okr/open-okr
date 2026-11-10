import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  fillDefaultPlanAsOperator,
  reviewDefaultPlanFill,
} from "../src/operator/default-plan.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { setPlanAsOperator } from "../src/operator/plans.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Putting every workspace with no plan on the default plan
 * (docs/design/workspaces-without-a-plan.md §3 and §5, plan 0.8.0 O2).
 *
 * Small (2 people) fits the default plan's 3 seats; Large (5) does not; Paid
 * already has a plan and is never listed.
 */

const OPERATOR = "fill-operator";
const SMALL = "fill-small";
const LARGE = "fill-large";
const PAID = "fill-paid";

const PLANS = [
  { key: "free", name: "Free", seats: 3, aiCredits: 100 },
  { key: "team", name: "Team", seats: 20, aiCredits: 1000 },
];

const ids: Record<string, string> = {};

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const addPeople = async (workspaceId: string, count: number) => {
  const wb = await workerDb();
  for (let n = 0; n < count; n += 1) {
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'human', 'active')",
      [newId(), workspaceId, `Person ${n}`],
    );
  }
};

const setting = async (key: string, value: unknown) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into system_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
    [key, JSON.stringify(value)],
  );
};

const planOf = async (workspaceId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select plan_key from tenants where workspace_id = $1",
    [workspaceId],
  );
  return (rows[0] as { plan_key: string | null }).plan_key;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  for (const id of [OPERATOR, SMALL, LARGE, PAID]) {
    await seedUser(id);
  }
  for (const owner of [SMALL, LARGE, PAID]) {
    ids[owner] = (
      await createWorkspace(wb.appPool, { user: { id: owner, name: owner } })
    ).workspaceId;
    await wb.admin.query(
      "insert into tenants (workspace_id, state, region) values ($1, 'active', 'local')",
      [ids[owner]],
    );
  }
  // The owner is one person; these add to them.
  await addPeople(ids[SMALL] as string, 1);
  await addPeople(ids[LARGE] as string, 4);
  await setting("cloud.plans", PLANS);
  await setting("cloud.defaultPlan", "free");
  // The first operator is granted by the deployment; nobody grants it to
  // themselves, so another account stands in as the granter.
  await grantOperator(wb.appPool, {
    email: `${OPERATOR}@example.com`,
    grantedByEmail: `${PAID}@example.com`,
  });
  await wb.admin.query(
    "update tenants set plan_key = 'team', seats = 20 where workspace_id = $1",
    [ids[PAID]],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the review", () => {
  it("splits the workspaces with no plan by the default plan's seats", async () => {
    const wb = await workerDb();
    const review = await reviewDefaultPlanFill(wb.appPool, OPERATOR);
    expect(review.catalogue).toBe(true);
    expect(review.defaultPlan).toEqual({
      key: "free",
      name: "Free",
      seats: 3,
      aiCredits: 100,
    });
    expect(review.willMove.map((one) => one.workspaceId)).toEqual([ids[SMALL]]);
    expect(review.willMove[0]?.people).toBe(2);
    expect(review.willRefuse.map((one) => one.workspaceId)).toEqual([
      ids[LARGE],
    ]);
    expect(review.willRefuse[0]?.people).toBe(5);
  });

  it("says when no default plan is set", async () => {
    const wb = await workerDb();
    await setting("cloud.defaultPlan", "");
    const review = await reviewDefaultPlanFill(wb.appPool, OPERATOR);
    expect(review.defaultPlan).toBeNull();
  });

  it("is for an operator only", async () => {
    const wb = await workerDb();
    await expect(reviewDefaultPlanFill(wb.appPool, SMALL)).rejects.toThrow(
      /No such page/,
    );
  });
});

describe("the run", () => {
  it("moves, refuses and skips, one audited change each, and one instance row", async () => {
    const wb = await workerDb();
    // Given a plan on S-46 after the review was opened.
    const third = (
      await createWorkspace(wb.appPool, {
        user: { id: OPERATOR, name: OPERATOR },
      })
    ).workspaceId;
    await wb.admin.query(
      "insert into tenants (workspace_id, state, region) values ($1, 'active', 'local')",
      [third],
    );
    await setPlanAsOperator(wb.appPool, {
      workspaceId: third,
      operatorUserId: OPERATOR,
      planKey: "team",
      reason: "Bought Team",
    });

    const result = await fillDefaultPlanAsOperator(wb.appPool, {
      operatorUserId: OPERATOR,
      reason: "Put on the default plan from the console",
      workspaceIds: [ids[SMALL] as string, ids[LARGE] as string, third],
    });

    expect(result.planKey).toBe("free");
    expect(result.moved).toEqual([ids[SMALL]]);
    expect(result.refused.map((one) => one.workspaceId)).toEqual([ids[LARGE]]);
    expect(result.refused[0]?.reason).toMatch(/3 seat\(s\) and 5 are in use/);
    expect(result.skipped).toEqual([
      { workspaceId: third, reason: "Already on team." },
    ]);

    expect(await planOf(ids[SMALL] as string)).toBe("free");
    expect(await planOf(ids[LARGE] as string)).toBeNull();
    expect(await planOf(third)).toBe("team");

    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where workspace_id = $1 and action = 'workspace.changePlan'",
      [ids[SMALL]],
    );
    expect(audit.rows[0]?.payload).toMatchObject({
      planKey: "free",
      by: "operator",
      bulk: true,
    });

    const instance = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from instance_audit_events where action = 'operator.default_plan_filled'",
    );
    expect(instance.rows).toHaveLength(1);
    expect(instance.rows[0]?.payload).toMatchObject({
      planKey: "free",
      moved: 1,
      refused: 1,
      skipped: 1,
    });
  });

  it("is refused with no default plan", async () => {
    const wb = await workerDb();
    await setting("cloud.defaultPlan", "");
    await expect(
      fillDefaultPlanAsOperator(wb.appPool, {
        operatorUserId: OPERATOR,
        reason: "x",
        workspaceIds: [ids[SMALL] as string],
      }),
    ).rejects.toThrow(/No default plan is set/);
    expect(await planOf(ids[SMALL] as string)).toBeNull();
  });
});
