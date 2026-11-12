import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { type ActionName, callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * `kpis.deleteRecord` (docs/design/kpi-engine.md, "Removing a period's value").
 *
 * It exists for the copilot's undo of a value it recorded for a period that
 * had none. Rows settle what it must do: the soft delete, the same recompute
 * chain as `kpis.record`, and the revival of the row when the period is
 * recorded again.
 */

const OWNER = "delrec-owner";
const VIEWER = "delrec-viewer";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;

type Input<K extends ActionName> = Parameters<typeof callAction<K>>[2];

async function call<K extends ActionName>(
  name: K,
  input: Input<K>,
  userId = OWNER,
) {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    name,
    input,
  );
}

const makeKpi = (title: string, targetDefault = 200) =>
  call("kpis.create", {
    title,
    frequency: "monthly",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "output",
    aggregate: "sum",
    ownerKind: "workspace",
    targetDefault,
  });

const record = (kpiId: string, on: string, actualValue: number) =>
  call("kpis.record", { kpiId, on, actualValue });

type Grid = {
  kpis: {
    id: string;
    state: string;
    records: { periodStart: string; actualValue: number | null }[];
  }[];
};

async function periods(kpiId: string): Promise<string[]> {
  const grid = (await call("kpis.grid", { periods: 12 })) as unknown as Grid;
  return (
    grid.kpis
      .find((row) => row.id === kpiId)
      ?.records.map((r) => r.periodStart) ?? []
  );
}

async function stateOf(kpiId: string): Promise<string | undefined> {
  const grid = (await call("kpis.grid", { periods: 12 })) as unknown as Grid;
  return grid.kpis.find((row) => row.id === kpiId)?.state;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "delrec-owner@example.com",
      VIEWER,
      "Viewer",
      "delrec-viewer@example.com",
    ],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  cycleId = (await call("cycles.current", { mode: "quarterly" }))?.id as string;
  const members = await wb.admin.query<{ id: string }>(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  ownerMemberId = members.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("removing a period's value", () => {
  it("omits the period from the grid and writes an audit row", async () => {
    const kpi = await makeKpi("Weekly active teams");
    await record(kpi.id, "2026-08-11", 50);
    const second = await record(kpi.id, "2026-09-11", 150);
    expect(await periods(kpi.id)).toContain("2026-09-01");

    const removed = await call("kpis.deleteRecord", { id: second.id });
    expect(removed.id).toBe(second.id);

    expect(await periods(kpi.id)).not.toContain("2026-09-01");
    expect(await periods(kpi.id)).toContain("2026-08-01");

    const wb = await workerDb();
    const audit = await wb.admin.query(
      "select 1 from audit_events where workspace_id = $1 and action = 'kpis.deleteRecord' and target_id = $2",
      [workspaceId, second.id],
    );
    expect(audit.rowCount).toBe(1);
    const activity = await wb.admin.query(
      "select 1 from activities where workspace_id = $1 and kind = 'kpi.value_removed'",
      [workspaceId],
    );
    expect(activity.rowCount).toBe(1);
  });

  it("recomputes the KPI's state when the only value goes", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const only = await record(kpi.id, "2026-08-11", 200);
    expect(await stateOf(kpi.id)).not.toBe("no_data");

    await call("kpis.deleteRecord", { id: only.id });

    expect(await stateOf(kpi.id)).toBe("no_data");
  });

  it("moves a linked key result and its goal back to the earlier reading", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const goal = await call("goals.create", {
      title: "Teams make the product a weekly habit",
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    });
    await call("goals.addKeyResult", {
      goalId: goal.id,
      title: "Weekly active teams from 40 to 200",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 40,
      targetValue: 200,
      weight: 1,
      kpiId: kpi.id,
    });
    await record(kpi.id, "2026-08-11", 50);
    const later = await record(kpi.id, "2026-09-11", 150);
    expect((await call("goals.read", { id: goal.id })).progressPct).toBe(68.75);

    await call("kpis.deleteRecord", { id: later.id });

    const after = await call("goals.read", { id: goal.id });
    expect(after.keyResults[0]?.currentValue).toBe(50);
    expect(after.progressPct).toBe(6.25);
  });

  it("recomputes a calculated KPI that reads the removed value", async () => {
    const a = await makeKpi("Self-serve sign-ups", 100);
    const b = await makeKpi("Sales-led sign-ups", 100);
    const sum = await makeKpi("All sign-ups", 100);
    await record(a.id, "2026-08-11", 10);
    const bRecord = await record(b.id, "2026-08-11", 5);
    await call("kpis.setFormula", {
      kpiId: sum.id,
      formula: { op: "add", l: { k: a.id }, r: { k: b.id } },
      on: "2026-08-11",
    });
    const wb = await workerDb();
    const read = () =>
      wb.admin.query<{ actual_value: string | null }>(
        "select actual_value from kpi_records where kpi_id = $1 and period_start = '2026-08-01'",
        [sum.id],
      );
    expect(Number((await read()).rows[0]?.actual_value)).toBe(15);

    await call("kpis.deleteRecord", { id: bRecord.id });

    // A missing source makes the sum unknown, so no actual value is stored.
    expect((await read()).rows[0]?.actual_value).toBeNull();
  });

  it("brings the value back when the same period is recorded again", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const first = await record(kpi.id, "2026-08-11", 50);
    await call("kpis.deleteRecord", { id: first.id });
    expect(await periods(kpi.id)).not.toContain("2026-08-01");

    const again = await record(kpi.id, "2026-08-20", 70);

    expect(again.id).toBe(first.id);
    expect(await periods(kpi.id)).toContain("2026-08-01");
  });
});

describe("refusals", () => {
  it("refuses a calculated KPI's record", async () => {
    const a = await makeKpi("Self-serve sign-ups", 100);
    const sum = await makeKpi("All sign-ups", 100);
    await record(a.id, "2026-08-11", 10);
    await call("kpis.setFormula", {
      kpiId: sum.id,
      formula: { op: "add", l: { k: a.id }, r: { k: a.id } },
      on: "2026-08-11",
    });
    const wb = await workerDb();
    const row = await wb.admin.query<{ id: string }>(
      "select id from kpi_records where kpi_id = $1 and deleted_at is null",
      [sum.id],
    );
    const id = row.rows[0]?.id as string;
    expect(id).toBeTruthy();

    await expect(call("kpis.deleteRecord", { id })).rejects.toThrow(
      /calculated/i,
    );
  });

  it("refuses a record that does not exist", async () => {
    await expect(
      call("kpis.deleteRecord", {
        id: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(/No such/);
  });

  it("refuses a record that is already deleted", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const first = await record(kpi.id, "2026-08-11", 50);
    await call("kpis.deleteRecord", { id: first.id });
    await expect(call("kpis.deleteRecord", { id: first.id })).rejects.toThrow(
      /No such/,
    );
  });

  it("refuses a member who holds Viewer", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const first = await record(kpi.id, "2026-08-11", 50);

    const wb = await workerDb();
    const inserted = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
       values (gen_random_uuid(), $1, $2, 'Viewer', 'human', 'active',
               (select id from workspace_roles where workspace_id = $1 and builtin_key = 'viewer'))
       returning id`,
      [workspaceId, VIEWER],
    );
    const memberId = inserted.rows[0]?.id as string;
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.grant-edit",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const subject = await resolveSubjectContext(
            tx,
            "workspace",
            workspaceId,
            workspaceId,
          );
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: (subject as { contextId: string }).contextId,
            level: ACCESS_LEVELS.edit,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.grant-edit",
              subjectType: "workspace_member",
              subjectId: memberId,
            },
            audit: {
              action: "test.grant-edit",
              targetType: "workspace_member",
            },
          };
        },
      },
    );

    await expect(
      call("kpis.deleteRecord", { id: first.id }, VIEWER),
    ).rejects.toThrow("kpis.deleteRecord needs a higher access level");
    expect(await periods(kpi.id)).toContain("2026-08-01");
  });
});
