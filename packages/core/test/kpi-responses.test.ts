import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { kpiResponsesInTx } from "../src/kpis/service.ts";
import type { OperationTx } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The three responses to an unhealthy KPI (METHOD.md §6.5, §6.6, P9-T18b).
 *
 * A recovery has its own suite in `kpis.test.ts`. What is checked here is the
 * other two: that fixing it now is a task with an owner and a date and no
 * recovery objective, that a key result on an objective that exists answers
 * it, that the recovery board shows the answer while it is open and asks
 * again once it is not, and that a reader who cannot open the work is not
 * told what it is.
 */

const OWNER = "response-owner";

let workspaceId: string;
let ownerMemberId: string;
let spaceId: string;
let cycleId: string;

const call = async <T>(name: string, input: unknown): Promise<T> =>
  (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  )) as T;

interface Card {
  kpiId: string;
  recovery: { goalId: string } | null;
  spaceId: string | null;
  ownerMemberId: string | null;
  response: {
    kind: string;
    subjectId: string | null;
    title: string | null;
    dueOn: string | null;
    goalId: string | null;
    goalTitle: string | null;
    open: boolean;
  } | null;
}

const cardOf = async (kpiId: string) =>
  (await call<{ cards: Card[] }>("kpis.recoveryBoard", {})).cards.find(
    (card) => card.kpiId === kpiId,
  );

/** Sixty of a hundred, below the seventy percent watch floor. */
const unhealthyKpi = async (title = "Operating margin") => {
  const kpi = await call<{ id: string }>("kpis.create", {
    title,
    indicatorType: "lagging",
    aggregate: "sum",
    ownerKind: "workspace",
    ownerMemberId,
    frequency: "monthly",
    direction: "higher_better",
    targetDefault: 100,
  });
  const recorded = await call<{ state: string }>("kpis.record", {
    kpiId: kpi.id,
    on: "2026-08-11",
    actualValue: 60,
  });
  expect(recorded.state).toBe("unhealthy");
  return kpi.id;
};

const goalCount = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1",
    [workspaceId],
  );
  return Number(rows[0]?.count);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Response Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Response Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  cycleId = (
    (await call<{ id: string }>("cycles.current", { mode: "quarterly" })) ?? {
      id: "",
    }
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("fixing it now", () => {
  /**
   * The acceptance criterion: "Given an unhealthy KPI, when 'fix it now' is
   * chosen, then a task with an owner and a date exists and no recovery OKR
   * was drafted."
   */
  it("acceptance: is a task with an owner and a date, and no recovery objective", async () => {
    const kpiId = await unhealthyKpi();
    const goalsBefore = await goalCount();

    const task = await call<{ id: string }>("tasks.create", {
      spaceId,
      title: "Reprice the two loss-making plans",
      status: "todo",
      dueOn: "2026-08-29",
      assigneeIds: [ownerMemberId],
    });
    expect(
      await call<{ kpiId: string; kind: string }>("kpis.recordResponse", {
        kpiId,
        kind: "fix_now",
        taskId: task.id,
      }),
    ).toEqual({ kpiId, kind: "fix_now" });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      due_on: string;
      member_id: string;
    }>(
      `select t.due_on::text as due_on, a.member_id
         from tasks t join task_assignees a on a.task_id = t.id
        where t.id = $1`,
      [task.id],
    );
    expect(rows).toEqual([{ due_on: "2026-08-29", member_id: ownerMemberId }]);

    // No recovery was drafted, launched or attached.
    expect(await goalCount()).toBe(goalsBefore);
    const kpi = await wb.admin.query<{
      recovery_goal_id: string | null;
      response_kind: string;
      responded_by_member_id: string;
    }>(
      "select recovery_goal_id, response_kind, responded_by_member_id from kpis where id = $1",
      [kpiId],
    );
    expect(kpi.rows[0]).toEqual({
      recovery_goal_id: null,
      response_kind: "fix_now",
      responded_by_member_id: ownerMemberId,
    });

    // The board shows the answer rather than offering the three again.
    const card = await cardOf(kpiId);
    expect(card?.recovery).toBeNull();
    expect(card?.response).toEqual({
      kind: "fix_now",
      subjectId: task.id,
      title: "Reprice the two loss-making plans",
      dueOn: "2026-08-29",
      goalId: null,
      goalTitle: null,
      open: true,
    });
  });

  it("asks again once the task is done and the KPI is still unhealthy", async () => {
    const kpiId = await unhealthyKpi();
    const task = await call<{ id: string }>("tasks.create", {
      spaceId,
      title: "Chase the late invoices",
      dueOn: "2026-08-29",
      assigneeIds: [ownerMemberId],
    });
    await call("kpis.recordResponse", {
      kpiId,
      kind: "fix_now",
      taskId: task.id,
    });
    const wb = await workerDb();
    await wb.admin.query("update tasks set status = 'done' where id = $1", [
      task.id,
    ]);
    // Still on the board, because it is still unhealthy, and the answer it
    // had is history.
    expect((await cardOf(kpiId))?.response?.open).toBe(false);
  });

  it("refuses a fix with no task, and a task that does not exist", async () => {
    const kpiId = await unhealthyKpi();
    await expect(
      call("kpis.recordResponse", { kpiId, kind: "fix_now" }),
    ).rejects.toThrow(/needs the task/);
    await expect(
      call("kpis.recordResponse", {
        kpiId,
        kind: "fix_now",
        taskId: "0190d1a0-0000-7000-8000-000000000000",
      }),
    ).rejects.toThrow();
  });

  it("carries the KPI's space and owner, so the form can default them", async () => {
    const kpiId = await unhealthyKpi();
    const card = await cardOf(kpiId);
    expect(card?.ownerMemberId).toBe(ownerMemberId);
    expect(card?.spaceId).toBeNull();
  });
});

describe("adding a key result", () => {
  it("answers it on an objective that already exists, reading the KPI", async () => {
    const kpiId = await unhealthyKpi("Gross margin");
    const goalId = (
      await call<{ id: string }>("goals.create", {
        title: "Run the business on sound unit economics",
        cycleId,
        level: "team",
        ownerKind: "workspace",
        championId: ownerMemberId,
      })
    ).id;
    const goalsBefore = await goalCount();

    const keyResult = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Gross margin from 60 to 90",
      kind: "metric",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 60,
      targetValue: 90,
      weight: 1,
      kpiId,
    });
    await call("kpis.recordResponse", {
      kpiId,
      kind: "key_result",
      keyResultId: keyResult.id,
    });

    expect(await goalCount()).toBe(goalsBefore);
    const card = await cardOf(kpiId);
    expect(card?.recovery).toBeNull();
    expect(card?.response).toEqual({
      kind: "key_result",
      subjectId: keyResult.id,
      title: "Gross margin from 60 to 90",
      dueOn: null,
      goalId,
      goalTitle: "Run the business on sound unit economics",
      open: true,
    });

    // The key result is the KPI's: it reads it rather than a typed value.
    const wb = await workerDb();
    const linked = await wb.admin.query<{ kpi_id: string }>(
      "select kpi_id from key_results where id = $1",
      [keyResult.id],
    );
    expect(linked.rows[0]?.kpi_id).toBe(kpiId);
  });

  it("refuses a key result that does not exist", async () => {
    const kpiId = await unhealthyKpi();
    await expect(
      call("kpis.recordResponse", { kpiId, kind: "key_result" }),
    ).rejects.toThrow(/needs the key result/);
    await expect(
      call("kpis.recordResponse", {
        kpiId,
        kind: "key_result",
        keyResultId: "0190d1a0-0000-7000-8000-000000000000",
      }),
    ).rejects.toThrow(/No such key result/);
  });
});

describe("a reader who cannot open the answer", () => {
  it("is told the KPI was answered, and not with what", async () => {
    const kpiId = await unhealthyKpi();
    const task = await call<{ id: string }>("tasks.create", {
      spaceId,
      title: "Renegotiate the hosting contract",
      dueOn: "2026-08-29",
      assigneeIds: [ownerMemberId],
    });
    await call("kpis.recordResponse", {
      kpiId,
      kind: "fix_now",
      taskId: task.id,
    });

    const wb = await workerDb();
    // A member who has been suspended sees nothing, which is the plainest
    // reader the set-shaped getter refuses everything to.
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, status)
       values (gen_random_uuid(), $1, 'Suspended Reader', 'suspended')
       returning id`,
      [workspaceId],
    );
    const readerId = rows[0]?.id as string;
    const responses = await withWorkspace(wb.db, workspaceId, (tx) =>
      kpiResponsesInTx(
        tx as unknown as OperationTx,
        workspaceId,
        [
          {
            id: kpiId,
            responseKind: "fix_now",
            responseTaskId: task.id,
            responseKeyResultId: null,
          },
        ],
        { memberId: readerId },
      ),
    );
    expect(responses.get(kpiId)).toMatchObject({
      kind: "fix_now",
      subjectId: null,
      title: null,
      dueOn: null,
      open: true,
    });
  });
});
