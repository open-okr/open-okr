import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { type ActionName, callAction } from "../src/actions/registry.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Key results that read a KPI (TECHNICAL-PLAN §6.2, design
 * `p3-t00-kpi-engine.md` §10, completeness review M-07).
 *
 * "A KPI-backed key result reads the KPI's latest achievement." The scoring
 * cascade already read it, but only when something else asked it to run: a
 * value typed into the KPI grid moved the KPI and left every key result that
 * reads it, and every goal above those, where they were until somebody
 * checked in on the goal for an unrelated reason.
 *
 * What only rows can settle: that one KPI write moves the key result, its goal
 * and the goal above it in the same Operation, that a calculated KPI the
 * cascade recomputes does the same, and that nothing else moves.
 */

const OWNER = "linked-owner";
const OTHER = "linked-other";
const READER = "linked-reader";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

type Input<K extends ActionName> = Parameters<typeof callAction<K>>[2];

async function call<K extends ActionName>(
  name: K,
  input: Input<K>,
  userId = OWNER,
) {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context(userId) }, name, input);
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

const makeGoal = (title: string, parentGoalId?: string) =>
  call("goals.create", {
    title,
    cycleId,
    level: "company",
    ownerKind: "workspace",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
    ...(parentGoalId ? { parentGoalId } : {}),
  });

const addKeyResult = (
  goalId: string,
  extra: Partial<Input<"goals.addKeyResult">> = {},
) =>
  call("goals.addKeyResult", {
    goalId,
    title: "Weekly active teams from 40 to 200",
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 40,
    targetValue: 200,
    weight: 1,
    ...extra,
  });

const readGoal = (id: string) => call("goals.read", { id });

const history = async (keyResultId: string) =>
  (await call("goals.keyResultHistory", { keyResultId, limit: 100 })).values;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)",
    [
      OWNER,
      "Owner",
      "linked-owner@example.com",
      OTHER,
      "Other",
      "linked-other@example.com",
      READER,
      "Reader",
      "linked-reader@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await call("cycles.current", { mode: "quarterly" });
  cycleId = current?.id as string;

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

describe("recording a KPI moves the key results that read it", () => {
  it("moves the key result, its goal and the goal above it", async () => {
    // The goal above counts its child only where the workspace rolls aligned
    // goals up, which is off by default since P9-T12b (METHOD.md §3.1).
    await call("practice.update", { overrides: { "progress.rollUp": "on" } });
    const kpi = await makeKpi("Weekly active teams");
    const parent = await makeGoal("Teams make the product a weekly habit");
    const child = await makeGoal(
      "Mid-market teams come back every week",
      parent.id,
    );
    const keyResult = await addKeyResult(child.id, { kpiId: kpi.id });

    // Nothing recorded yet: unmeasured, not failing.
    expect((await readGoal(child.id)).progressPct).toBe(0);

    await record(kpi.id, "2026-08-11", 50);

    // 50 of a 200 target. The key result reads the KPI's achievement, not a
    // second formula over its own baseline and target.
    const childAfter = await readGoal(child.id);
    expect(childAfter.keyResults[0]?.progressPct).toBe(25);
    expect(childAfter.progressPct).toBe(25);
    // The parent has no key results of its own, so it is its child.
    expect((await readGoal(parent.id)).progressPct).toBe(25);

    // The value follows the KPI, and the movement is history like any other.
    expect(childAfter.keyResults[0]?.currentValue).toBe(50);
    const values = await history(keyResult.id);
    expect(values[0]).toMatchObject({ value: 50, source: "kpi" });

    // A second reading moves it again, in the same call.
    await record(kpi.id, "2026-08-20", 150);
    expect((await readGoal(child.id)).progressPct).toBe(75);
    expect((await readGoal(parent.id)).progressPct).toBe(75);
  });

  it("moves a key result reading a calculated KPI the cascade recomputes", async () => {
    const a = await makeKpi("Self-serve sign-ups", 100);
    const b = await makeKpi("Sales-led sign-ups", 100);
    const sum = await makeKpi("All sign-ups", 100);
    await record(a.id, "2026-08-11", 10);
    await record(b.id, "2026-08-11", 5);
    await call("kpis.setFormula", {
      kpiId: sum.id,
      formula: { op: "add", l: { k: a.id }, r: { k: b.id } },
      on: "2026-08-11",
    });

    const goal = await makeGoal("New teams find us without a salesperson");
    await addKeyResult(goal.id, {
      kpiId: sum.id,
      baselineValue: 0,
      targetValue: 100,
    });
    expect((await readGoal(goal.id)).progressPct).toBe(15);

    // A source changes. The calculated KPI is recomputed by the cascade, and
    // the key result reading it follows in the same Operation.
    await record(a.id, "2026-08-20", 40);

    const after = await readGoal(goal.id);
    expect(after.keyResults[0]?.currentValue).toBe(45);
    expect(after.keyResults[0]?.progressPct).toBe(45);
    expect(after.progressPct).toBe(45);
  });

  it("leaves a key result that reads nothing, or reads another KPI, alone", async () => {
    const read = await makeKpi("Weekly active teams");
    const unrelated = await makeKpi("Support tickets per team");
    await record(unrelated.id, "2026-08-11", 20);

    const linked = await makeGoal("Teams make the product a weekly habit");
    await addKeyResult(linked.id, { kpiId: read.id });

    const manual = await makeGoal("Onboarding takes two days");
    const byHand = await addKeyResult(manual.id, {
      title: "Median onboarding from 10 days to 2",
      direction: "reduce",
      baselineValue: 10,
      targetValue: 2,
    });
    await call("goals.recordValue", { id: byHand.id, value: 6 });

    const other = await makeGoal("Fewer teams need support");
    const onOther = await addKeyResult(other.id, { kpiId: unrelated.id });

    const manualBefore = await readGoal(manual.id);
    const otherBefore = await readGoal(other.id);
    const byHandHistory = (await history(byHand.id)).length;
    const onOtherHistory = (await history(onOther.id)).length;

    await record(read.id, "2026-08-11", 100);

    expect((await readGoal(linked.id)).progressPct).toBe(50);
    const manualAfter = await readGoal(manual.id);
    expect(manualAfter.progressPct).toBe(manualBefore.progressPct);
    expect(manualAfter.keyResults[0]?.currentValue).toBe(6);
    expect((await history(byHand.id)).length).toBe(byHandHistory);
    const otherAfter = await readGoal(other.id);
    expect(otherAfter.progressPct).toBe(otherBefore.progressPct);
    expect((await history(onOther.id)).length).toBe(onOtherHistory);
  });

  it("leaves a closed goal as it was closed", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const goal = await makeGoal("Teams make the product a weekly habit");
    const keyResult = await addKeyResult(goal.id, { kpiId: kpi.id });
    await record(kpi.id, "2026-08-11", 50);

    await call("goals.close", {
      id: goal.id,
      successStatus: "missed",
      closeDecision: "modify",
      retrospectiveBody: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Half the teams came back." }],
          },
        ],
      },
    } as never);
    const before = (await history(keyResult.id)).length;

    await record(kpi.id, "2026-08-20", 180);

    const after = await readGoal(goal.id);
    expect(after.keyResults[0]?.currentValue).toBe(50);
    expect((await history(keyResult.id)).length).toBe(before);
  });

  it("moves a goal the recorder cannot see, and tells them nothing about it", async () => {
    // A support session's guest, let in at edit. A guest reaches nothing
    // through the workspace-wide binding every goal carries, so the goal is
    // invisible to them. The KPI is not: KPIs sit at the workspace floor, and
    // edit on the workspace is what recording one asks for.
    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.admit-guest",
        workspaceId,
        actor: { kind: "system" },
        async execute({ tx }) {
          await provisionMemberForInvite(tx, {
            workspaceId,
            user: { id: READER, name: "Guest" },
            kind: "guest",
            level: ACCESS_LEVELS.edit,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.admit-guest",
              subjectType: "workspace",
              subjectId: workspaceId,
            },
            audit: { action: "test.admit-guest", targetType: "workspace" },
          };
        },
      },
    );
    const kpi = await makeKpi("Weekly active teams");
    const title = "Teams make the product a weekly habit";
    const goal = await makeGoal(title);
    await addKeyResult(goal.id, { kpiId: kpi.id });
    await expect(call("goals.read", { id: goal.id }, READER)).rejects.toThrow(
      /No such/,
    );

    const recorded = await call(
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-11", actualValue: 50 },
      READER,
    );

    // The goal follows the KPI whoever recorded it. A goal that moved only
    // for readers who could see it would be two numbers for one measure.
    expect((await readGoal(goal.id)).progressPct).toBe(25);

    // And the recorder learns nothing: not from the answer, not from the
    // goal, and not from their own feed.
    expect(JSON.stringify(recorded)).not.toContain(goal.id);
    await expect(call("goals.read", { id: goal.id }, READER)).rejects.toThrow(
      /No such/,
    );
    const feed = JSON.stringify(
      await call("activities.workspaceFeed", {}, READER),
    );
    expect(feed).not.toContain(goal.id);
    expect(feed).not.toContain(title);
  });

  it("moves the key result when the KPI's own target changes", async () => {
    const kpi = await makeKpi("Weekly active teams");
    const goal = await makeGoal("Teams make the product a weekly habit");
    await addKeyResult(goal.id, { kpiId: kpi.id });
    await record(kpi.id, "2026-08-11", 50);
    expect((await readGoal(goal.id)).progressPct).toBe(25);

    await call("kpis.update", { kpiId: kpi.id, targetDefault: 100 });

    expect((await readGoal(goal.id)).progressPct).toBe(50);
  });
});

describe("drafting a key result on a KPI", () => {
  it("starts from the KPI's latest reading and its achievement", async () => {
    const kpi = await makeKpi("Weekly active teams");
    await record(kpi.id, "2026-07-11", 30);
    await record(kpi.id, "2026-08-11", 80);

    const goal = await makeGoal("Teams make the product a weekly habit");
    const keyResult = await addKeyResult(goal.id, { kpiId: kpi.id });

    const read = await readGoal(goal.id);
    expect(read.keyResults[0]?.kpiId).toBe(kpi.id);
    // The newest period with a value, which is what the KPI itself reads.
    expect(read.keyResults[0]?.currentValue).toBe(80);
    expect(read.keyResults[0]?.progressPct).toBe(40);
    expect(read.progressPct).toBe(40);
    // One row, as for any key result: where the measure stood when it began.
    expect(await history(keyResult.id)).toHaveLength(1);
  });

  it("refuses a KPI in another workspace, and one that has been removed", async () => {
    const wb = await workerDb();
    const elsewhere = await provisionWorkspaceForUser(wb.appPool, {
      id: OTHER,
      name: "Other",
    });
    const foreign = await callAction(
      {
        pool: wb.appPool,
        workspaceId: elsewhere.workspaceId,
        actor: { kind: "human", userId: OTHER },
      },
      "kpis.create",
      {
        title: "Somebody else's metric",
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
        ownerKind: "workspace",
      },
    );
    const goal = await makeGoal("Teams make the product a weekly habit");

    // The foreign key accepts it, because a key check does not see row-level
    // security. The action is what refuses.
    await expect(addKeyResult(goal.id, { kpiId: foreign.id })).rejects.toThrow(
      /No such KPI/,
    );

    const removed = await makeKpi("Retired metric");
    await wb.admin.query("update kpis set deleted_at = now() where id = $1", [
      removed.id,
    ]);
    await expect(addKeyResult(goal.id, { kpiId: removed.id })).rejects.toThrow(
      /No such KPI/,
    );
    expect((await readGoal(goal.id)).keyResults).toHaveLength(0);
  });
});

describe("linking an existing key result to a KPI", () => {
  it("takes the KPI's reading and progress, and then refuses a typed value", async () => {
    const kpi = await makeKpi("Weekly active teams");
    await record(kpi.id, "2026-08-11", 100);
    const goal = await makeGoal("Teams make the product a weekly habit");
    const keyResult = await addKeyResult(goal.id);
    expect((await readGoal(goal.id)).progressPct).toBe(0);

    await call("goals.linkKpi", { id: keyResult.id, kpiId: kpi.id });

    const read = await readGoal(goal.id);
    expect(read.keyResults[0]?.kpiId).toBe(kpi.id);
    expect(read.keyResults[0]?.currentValue).toBe(100);
    expect(read.progressPct).toBe(50);
    const values = await history(keyResult.id);
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ value: 100, source: "kpi" });

    await expect(
      call("goals.recordValue", { id: keyResult.id, value: 90 }),
    ).rejects.toThrow(/reads its value from a KPI/i);

    // And the next reading reaches it like any other linked key result.
    await record(kpi.id, "2026-08-20", 160);
    expect((await readGoal(goal.id)).progressPct).toBe(80);
  });

  it("refuses a key result that already reads a KPI", async () => {
    const first = await makeKpi("Weekly active teams");
    const second = await makeKpi("Daily active teams");
    const goal = await makeGoal("Teams make the product a weekly habit");
    const keyResult = await addKeyResult(goal.id, { kpiId: first.id });

    await expect(
      call("goals.linkKpi", { id: keyResult.id, kpiId: second.id }),
    ).rejects.toThrow(/already reads a KPI/);

    // Unlinking first is the way to change it, so the switch is on the record.
    await call("goals.unlinkKpi", { id: keyResult.id });
    await call("goals.linkKpi", { id: keyResult.id, kpiId: second.id });
    expect((await readGoal(goal.id)).keyResults[0]?.kpiId).toBe(second.id);
  });

  it("refuses a closed goal, which takes no new values", async () => {
    const kpi = await makeKpi("Weekly active teams");
    await record(kpi.id, "2026-08-11", 100);
    const goal = await makeGoal("Teams make the product a weekly habit");
    const keyResult = await addKeyResult(goal.id);
    await call("goals.close", {
      id: goal.id,
      successStatus: "missed",
      closeDecision: "modify",
      retrospectiveBody: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Measured by hand all quarter." }],
          },
        ],
      },
    } as never);
    const before = (await history(keyResult.id)).length;

    // Linking now would pull a reading into a record of how the cycle ended,
    // which is the one thing the cascade itself refuses to do.
    await expect(
      call("goals.linkKpi", { id: keyResult.id, kpiId: kpi.id }),
    ).rejects.toThrow(/closed/i);

    const read = await readGoal(goal.id);
    expect(read.keyResults[0]?.kpiId).toBeNull();
    expect(read.keyResults[0]?.currentValue).toBe(40);
    expect((await history(keyResult.id)).length).toBe(before);
  });

  it("refuses a member who may only read the goal", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, 'Reader', 'active')`,
      [workspaceId, READER],
    );
    const kpi = await makeKpi("Weekly active teams");
    const goal = await makeGoal("Teams make the product a weekly habit");
    const keyResult = await addKeyResult(goal.id);

    await expect(
      call("goals.linkKpi", { id: keyResult.id, kpiId: kpi.id }, READER),
    ).rejects.toThrow(/No such/);
    expect((await readGoal(goal.id)).keyResults[0]?.kpiId).toBeNull();
  });
});

describe("the KPIs a member can pick", () => {
  it("lists every live KPI in the workspace, by title, with its reading", async () => {
    const weekly = await makeKpi("Weekly active teams");
    await makeKpi("Churned teams");
    const removed = await makeKpi("Retired metric");
    await record(weekly.id, "2026-08-11", 50);
    const wb = await workerDb();
    await wb.admin.query("update kpis set deleted_at = now() where id = $1", [
      removed.id,
    ]);

    const listed = await call("kpis.list", {});

    expect(listed.kpis.map((kpi) => kpi.title)).toEqual([
      "Churned teams",
      "Weekly active teams",
    ]);
    expect(listed.kpis[1]).toMatchObject({
      id: weekly.id,
      frequency: "monthly",
      state: "unhealthy",
      achievementPct: 25,
      isCalculated: false,
    });
  });

  it("shows nothing from another workspace", async () => {
    const wb = await workerDb();
    const elsewhere = await provisionWorkspaceForUser(wb.appPool, {
      id: OTHER,
      name: "Other",
    });
    await callAction(
      {
        pool: wb.appPool,
        workspaceId: elsewhere.workspaceId,
        actor: { kind: "human", userId: OTHER },
      },
      "kpis.create",
      {
        title: "Somebody else's metric",
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
        ownerKind: "workspace",
      },
    );

    expect((await call("kpis.list", {})).kpis).toEqual([]);
  });
});
