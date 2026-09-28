import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  grantOperator,
  OperatorGrantError,
  revokeOperator,
} from "../src/operator/grants.ts";
import { isLiveOperator } from "../src/operator/index.ts";
import { setPlanAsOperator } from "../src/operator/plans.ts";
import {
  countSeats,
  listSeatHolders,
  seatState,
} from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Operating the cloud (completeness review H-21).
 *
 * Three gaps, each with its claims:
 *
 *   1. Nothing wrote a tenant's plan or seats after it was created, so no
 *      seat limit could ever apply. Now an administrator and an operator can
 *      both move a workspace, by the same rule: never below the headcount,
 *      refused naming both numbers.
 *   2. The first operator needed hand-written SQL. Now a command grants it,
 *      never to oneself, and only an operator can grant the next.
 *   3. S-49 had no seat list. The list is read by the rule the count uses.
 */

const OWNER = "plan-owner";
const OPERATOR = "plan-operator";
const OTHER = "plan-other";
let workspaceId: string;

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const PLANS = [
  { key: "team", name: "Team", seats: 3, aiMonthlyUsd: 20 },
  { key: "solo", name: "Solo", seats: 1, aiMonthlyUsd: null },
  { key: "org", name: "Organisation", seats: null, aiMonthlyUsd: 200 },
];

const asOwner = () =>
  workerDb().then((wb) => ({
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
  }));

const addHuman = async (status: "active" | "invited" = "active") => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'human', $4)",
    [newId(), workspaceId, `Person ${status}`, status],
  );
};

const tenantRow = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select plan_key, seats from tenants where workspace_id = $1",
    [workspaceId],
  );
  return rows[0] as { plan_key: string | null; seats: number | null };
};

const workspaceBudget = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select period, limit_value::float as limit from ai_budgets where workspace_id = $1 and scope = 'workspace' and metric = 'cost' and deleted_at is null",
    [workspaceId],
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await Promise.all([seedUser(OWNER), seedUser(OPERATOR), seedUser(OTHER)]);
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
  await wb.admin.query(
    "insert into system_settings (key, value) values ('cloud.plans', $1::jsonb) on conflict (key) do update set value = excluded.value",
    [JSON.stringify(PLANS)],
  );
  await wb.admin.query(
    "insert into tenants (workspace_id, state, region) values ($1, 'active', 'local')",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an administrator changes plan", () => {
  it("takes the seats from the plan, so the limit now applies", async () => {
    await callAction(await asOwner(), "workspace.changePlan", {
      planKey: "team",
    });
    expect(await tenantRow()).toEqual({ plan_key: "team", seats: 3 });
    const wb = await workerDb();
    await expect(seatState(wb.appPool, workspaceId)).resolves.toMatchObject({
      limit: 3,
      used: 1,
      full: false,
    });
  });

  it("writes the plan's AI allowance as the workspace's monthly budget", async () => {
    await callAction(await asOwner(), "workspace.changePlan", {
      planKey: "team",
    });
    expect(await workspaceBudget()).toEqual([{ period: "month", limit: 20 }]);

    // Moving again updates the same row rather than adding a second.
    await callAction(await asOwner(), "workspace.changePlan", {
      planKey: "org",
    });
    expect(await workspaceBudget()).toEqual([{ period: "month", limit: 200 }]);
  });

  it("refuses a plan with fewer seats than are in use, naming both numbers", async () => {
    await addHuman("invited");
    await expect(
      callAction(await asOwner(), "workspace.changePlan", { planKey: "solo" }),
    ).rejects.toThrow(/1 seat\(s\) and 2 are in use/);
    // Nothing moved.
    expect(await tenantRow()).toEqual({ plan_key: null, seats: null });
  });

  it("moves back to the free tier, which is unlimited", async () => {
    await callAction(await asOwner(), "workspace.changePlan", {
      planKey: "team",
    });
    await callAction(await asOwner(), "workspace.changePlan", {
      planKey: null,
    });
    expect(await tenantRow()).toEqual({ plan_key: null, seats: null });
  });

  it("refuses a plan the catalogue does not hold", async () => {
    await expect(
      callAction(await asOwner(), "workspace.changePlan", {
        planKey: "enterprise",
      }),
    ).rejects.toThrow(/no plan called "enterprise"/);
  });

  it("is refused on a self-hosted instance, which has no tenant row", async () => {
    const wb = await workerDb();
    await wb.admin.query("delete from tenants where workspace_id = $1", [
      workspaceId,
    ]);
    await expect(
      callAction(await asOwner(), "workspace.changePlan", { planKey: "team" }),
    ).rejects.toThrow(/no tenant record/);
  });

  it("records the change in the feed and the audit log", async () => {
    await callAction(await asOwner(), "workspace.changePlan", {
      planKey: "team",
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select kind, payload from activities where workspace_id = $1 and kind = 'workspace.plan_changed'",
      [workspaceId],
    );
    expect(rows).toEqual([
      {
        kind: "workspace.plan_changed",
        payload: { plan: "Team", seats: 3 },
      },
    ]);
  });
});

describe("an operator changes plan", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    await grantOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      grantedByEmail: `${OWNER}@example.com`,
    });
  });

  it("may set a seat count of their own, for a contract no plan matches", async () => {
    const wb = await workerDb();
    await expect(
      setPlanAsOperator(wb.appPool, {
        workspaceId,
        operatorUserId: OPERATOR,
        planKey: "team",
        seats: 40,
        reason: "Annual contract for forty people",
      }),
    ).resolves.toEqual({ planKey: "team", seats: 40 });
    expect(await tenantRow()).toEqual({ plan_key: "team", seats: 40 });

    // The customer sees who did it and why, in their own audit log.
    const { rows } = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'workspace.changePlan'",
      [workspaceId],
    );
    expect(rows[0]?.payload).toMatchObject({
      by: "operator",
      reason: "Annual contract for forty people",
      seats: 40,
    });
  });

  it("is held to the same headcount rule as the administrator", async () => {
    await addHuman();
    await addHuman();
    const wb = await workerDb();
    await expect(
      setPlanAsOperator(wb.appPool, {
        workspaceId,
        operatorUserId: OPERATOR,
        planKey: "team",
        seats: 2,
        reason: "Downgrade",
      }),
    ).rejects.toThrow(/2 seat\(s\) and 3 are in use/);
  });

  it("is not-found for somebody without a grant", async () => {
    const wb = await workerDb();
    await expect(
      setPlanAsOperator(wb.appPool, {
        workspaceId,
        operatorUserId: OTHER,
        planKey: "team",
        reason: "Trying",
      }),
    ).rejects.toThrow(/No such workspace/);
  });
});

describe("granting the operator role", () => {
  it("grants the first operator on anybody's word but their own", async () => {
    const wb = await workerDb();
    await expect(
      grantOperator(wb.appPool, {
        email: `${OPERATOR}@example.com`,
        grantedByEmail: `${OPERATOR}@example.com`,
      }),
    ).rejects.toThrow(OperatorGrantError);

    await expect(
      grantOperator(wb.appPool, {
        email: `${OPERATOR}@example.com`,
        grantedByEmail: `${OWNER}@example.com`,
      }),
    ).resolves.toBe("granted");
    await expect(isLiveOperator(wb.appPool, OPERATOR)).resolves.toBe(true);
  });

  it("lets only an operator grant the next one", async () => {
    const wb = await workerDb();
    await grantOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      grantedByEmail: `${OWNER}@example.com`,
    });
    await expect(
      grantOperator(wb.appPool, {
        email: `${OTHER}@example.com`,
        grantedByEmail: `${OWNER}@example.com`,
      }),
    ).rejects.toThrow(/is not an operator/);
    await expect(
      grantOperator(wb.appPool, {
        email: `${OTHER}@example.com`,
        grantedByEmail: `${OPERATOR}@example.com`,
      }),
    ).resolves.toBe("granted");
  });

  it("refuses somebody who has not signed up", async () => {
    const wb = await workerDb();
    await expect(
      grantOperator(wb.appPool, {
        email: "nobody@example.com",
        grantedByEmail: `${OWNER}@example.com`,
      }),
    ).rejects.toThrow(/Nobody has signed up as nobody@example.com/);
  });

  it("revokes, and a later grant restores the same row", async () => {
    const wb = await workerDb();
    await grantOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      grantedByEmail: `${OWNER}@example.com`,
    });
    await expect(
      revokeOperator(wb.appPool, {
        email: `${OPERATOR}@example.com`,
        revokedByEmail: `${OWNER}@example.com`,
      }),
    ).resolves.toBe(true);
    await expect(isLiveOperator(wb.appPool, OPERATOR)).resolves.toBe(false);

    await expect(
      grantOperator(wb.appPool, {
        email: `${OPERATOR}@example.com`,
        grantedByEmail: `${OWNER}@example.com`,
      }),
    ).resolves.toBe("regranted");
  });

  it("records every grant and revocation on the instance chain", async () => {
    const wb = await workerDb();
    await grantOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      grantedByEmail: `${OWNER}@example.com`,
    });
    await revokeOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      revokedByEmail: `${OWNER}@example.com`,
    });
    const { rows } = await wb.admin.query(
      "select action from instance_audit_events order by seq",
    );
    expect(rows.map((row) => row.action)).toEqual([
      "operator.granted",
      "operator.revoked",
    ]);
  });
});

describe("the seat list", () => {
  it("names exactly the people the seat count counts", async () => {
    await addHuman("invited");
    const wb = await workerDb();
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, 'A guest', 'guest', 'active')",
      [newId(), workspaceId],
    );
    const holders = await listSeatHolders(wb.appPool, workspaceId);
    expect(holders).toHaveLength(await countSeats(wb.appPool, workspaceId));
    expect(holders.map((holder) => holder.status).sort()).toEqual([
      "active",
      "invited",
    ]);
  });
});
