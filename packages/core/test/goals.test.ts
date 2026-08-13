import {
  goals as goalsTable,
  keyResults,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { sweepStaleness } from "../src/cadence/service.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Goals and key results against a real database (P3-T04, TECHNICAL-PLAN §4.4,
 * METHOD.md §2.5).
 *
 * The task's test plan, one test each: the single-parent invariant and cycle
 * rejection, closing requires an outcome and produces a retrospective, reopening
 * clears the outcome and keeps the retrospective, reassigning a reviewer rebinds
 * access, and weight clamping.
 *
 * Five of the invariants are check constraints in migration 0022 rather than
 * application code, so the tests that matter most here are the ones that drive a
 * refusal through the action and read the row back: a constraint nobody reaches
 * is a constraint nobody has tested.
 */

const OWNER = "goal-owner";
const SECOND = "goal-second";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

async function withTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

/** A paragraph of editor JSON, which is what a retrospective body has to be. */
const richText = (text: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as never;

async function createGoal(overrides: Record<string, unknown> = {}) {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "goals.create", {
    title: "Make mobile the way our customers prefer to reach us",
    cycleId,
    level: "company",
    championId: ownerMemberId,
    reviewerId: secondMemberId,
    ...overrides,
  } as never);
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Goal Owner",
      "goal-owner@example.com",
      SECOND,
      "Second Member",
      "goal-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Goal Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;

  // A second real member, made the way the product makes one, so the reviewer is
  // somebody other than the champion.
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Second Member', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
});

/** Runs a helper on a real Operation transaction, the way a job would. */
async function inOperationForWorkspace<T>(
  fn: (
    tx: Parameters<Parameters<typeof runOperation>[1]["execute"]>[0]["tx"],
  ) => Promise<T>,
): Promise<T> {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "test.sweep",
      workspaceId,
      actor: { kind: "system" },
      async execute({ tx }) {
        const result = await fn(tx);
        return {
          result,
          activity: {
            kind: "test.sweep",
            subjectType: "workspace",
            subjectId: workspaceId,
          },
          audit: { action: "test.sweep", targetType: "workspace" },
        };
      },
    },
  );
}

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("creating a goal", () => {
  it("persists at zero percent and pending, with its key results", async () => {
    // The task's acceptance criterion.
    const wb = await workerDb();
    const created = await createGoal();

    for (const [title, weight] of [
      ["Raise activation from 41% to 60%", 2],
      ["Cut median first response from 6h to 2h", 1],
    ] as const) {
      await callAction(
        { pool: wb.appPool, ...context() },
        "goals.addKeyResult",
        {
          goalId: created.id,
          title,
          direction: "increase",
          indicatorType: "leading",
          baselineValue: 41,
          targetValue: 60,
          weight,
        },
      );
    }

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );

    expect(read.progressPct).toBe(0);
    expect(read.health).toBe("pending");
    expect(read.champion.name).toBe("Goal Owner");
    expect(read.reviewer.name).toBe("Second Member");
    expect(read.keyResults).toHaveLength(2);
    // The current value defaults to the baseline, so progress starts at 0 rather
    // than undefined (§5.1).
    expect(read.keyResults[0]?.currentValue).toBe(41);
    expect(read.keyResults.map((kr) => kr.weight)).toEqual([2, 1]);
  });

  it("records the baseline as the first history row", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Raise activation from 41% to 60%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 41,
        targetValue: 60,
        weight: 1,
      },
    );

    const history = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.keyResultHistory",
      { keyResultId: keyResult.id, limit: 100 },
    );
    expect(history.values).toHaveLength(1);
    expect(history.values[0]?.value).toBe(41);
    expect(history.values[0]?.source).toBe("manual");
  });

  it("clamps a weight above the domain rather than refusing it", async () => {
    const wb = await workerDb();
    const created = await createGoal({ weight: 4000 });
    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.weight).toBe(100);

    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Raise activation",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 1,
        weight: -12,
      },
    );
    const after = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(after.keyResults.find((kr) => kr.id === keyResult.id)?.weight).toBe(
      0,
    );
  });

  it("refuses a goal that sits in a cycle and carries a timeframe", async () => {
    await expect(
      createGoal({
        timeframe: { startsOn: "2026-01-01", endsOn: "2026-12-31" },
      }),
    ).rejects.toThrow();
  });

  it("refuses a goal that sits in neither", async () => {
    await expect(createGoal({ cycleId: undefined })).rejects.toThrow();
  });

  it("refuses a champion who is not a member of this workspace", async () => {
    await expect(
      createGoal({ championId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow();
  });
});

describe("the single-parent invariant", () => {
  it("refuses two parents at the boundary", async () => {
    const wb = await workerDb();
    const parent = await createGoal();
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: parent.id,
        title: "Raise activation",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 1,
        weight: 1,
      },
    );

    await expect(
      createGoal({
        title: "A child with two parents",
        parentGoalId: parent.id,
        parentKeyResultId: keyResult.id,
      }),
    ).rejects.toThrow();
  });

  it("refuses a change that would make the alignment circular", async () => {
    const wb = await workerDb();
    const a = await createGoal({ title: "Goal A" });
    const b = await createGoal({ title: "Goal B", parentGoalId: a.id });

    // A's parent becomes B, and B's parent is already A.
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.update", {
        id: a.id,
        parentGoalId: b.id,
      }),
    ).rejects.toThrow(/circular/i);

    // A is unchanged, which is the half of the claim a refusal alone does not
    // prove.
    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: a.id },
    );
    expect(read.parentGoalId).toBeNull();
  });

  it("refuses a goal as its own parent", async () => {
    const wb = await workerDb();
    const a = await createGoal();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.update", {
        id: a.id,
        parentGoalId: a.id,
      }),
    ).rejects.toThrow(/circular/i);
  });

  it("clears the other pointer when one is set", async () => {
    const wb = await workerDb();
    const parent = await createGoal({ title: "Parent" });
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: parent.id,
        title: "Raise activation",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 1,
        weight: 1,
      },
    );
    const child = await createGoal({
      title: "Child",
      parentGoalId: parent.id,
    });

    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: child.id,
      parentKeyResultId: keyResult.id,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: child.id },
    );
    expect(read.parentKeyResultId).toBe(keyResult.id);
    expect(read.parentGoalId).toBeNull();
  });
});

describe("the close and reopen lifecycle", () => {
  it("refuses a close with no retrospective, in words", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.close", {
        id: created.id,
        successStatus: "achieved",
        closeDecision: "keep",
        retrospectiveBody: null,
      }),
    ).rejects.toThrow(/retrospective/i);
  });

  it("closes with an outcome, a decision and a retrospective", async () => {
    const wb = await workerDb();
    const created = await createGoal();

    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: created.id,
      successStatus: "achieved",
      closeDecision: "modify",
      closeReason: "The target was right, the tactic was not",
      retrospectiveBody: richText("Activation moved, onboarding did the work."),
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.successStatus).toBe("achieved");
    expect(read.closeDecision).toBe("modify");
    // A closed goal reads its outcome, never a live status.
    expect(read.health).toBe("achieved");
    expect(read.closedAt).not.toBeNull();
    expect(read.retrospective).not.toBeNull();

    // The audit row names who closed it.
    const audit = await wb.admin.query<{ action: string }>(
      "select action from audit_events where workspace_id = $1 and action = 'goals.close'",
      [workspaceId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("refuses a second close", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const close = () =>
      callAction({ pool: wb.appPool, ...context() }, "goals.close", {
        id: created.id,
        successStatus: "missed",
        closeDecision: "abandon",
        retrospectiveBody: richText("It did not move."),
      });
    await close();
    await expect(close()).rejects.toThrow(/already closed/i);
  });

  it("reopens, clearing the outcome and keeping the retrospective", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: created.id,
      successStatus: "missed",
      closeDecision: "keep",
      retrospectiveBody: richText("Ran out of quarter, not out of belief."),
    });

    await callAction({ pool: wb.appPool, ...context() }, "goals.reopen", {
      id: created.id,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.closedAt).toBeNull();
    expect(read.successStatus).toBeNull();
    expect(read.closeDecision).toBeNull();
    expect(read.health).toBe("pending");
    // The account of what happened survives. §4.3 is explicit about it.
    expect(read.retrospective).not.toBeNull();
  });

  it("refuses reopening a goal that is not closed", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.reopen", {
        id: created.id,
      }),
    ).rejects.toThrow(/not closed/i);
  });

  it("edits the one retrospective when a goal is closed twice", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: created.id,
      successStatus: "missed",
      closeDecision: "keep",
      retrospectiveBody: richText("First account."),
    });
    await callAction({ pool: wb.appPool, ...context() }, "goals.reopen", {
      id: created.id,
    });
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: created.id,
      successStatus: "achieved",
      closeDecision: "keep",
      retrospectiveBody: richText("Second account, same goal."),
    });

    const rows = await wb.admin.query(
      "select id from goal_retrospectives where goal_id = $1 and deleted_at is null",
      [created.id],
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("reassigning a role", () => {
  it("rebinds access rather than only moving the column", async () => {
    const wb = await workerDb();
    const created = await createGoal();

    await callAction({ pool: wb.appPool, ...context() }, "goals.reassignRole", {
      id: created.id,
      role: "reviewer",
      memberId: ownerMemberId,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.reviewer.id).toBe(ownerMemberId);

    // The binding moved with the column. A reassignment that updated one and not
    // the other would leave the outgoing reviewer holding access they no longer
    // have a reason for, which is the whole point of §4.4.
    const bindings = await wb.admin.query<{ tag: string; member_id: string }>(
      `select b.tag, g.member_id
         from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'goal'
          and c.resource_id = $1
          and b.tag = 'reviewer'
          and b.deleted_at is null`,
      [created.id],
    );
    expect(bindings.rows).toHaveLength(1);
    expect(bindings.rows[0]?.member_id).toBe(ownerMemberId);
  });

  it("refuses a member who is not in this workspace", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.reassignRole", {
        id: created.id,
        role: "champion",
        memberId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow();
  });
});

describe("the value history", () => {
  it("writes a row for every movement and moves the current value with it", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Raise activation from 41% to 60%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 41,
        targetValue: 60,
        weight: 1,
      },
    );

    for (const value of [48, 55]) {
      await callAction(
        { pool: wb.appPool, ...context() },
        "goals.recordValue",
        { id: keyResult.id, value },
      );
    }

    const history = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.keyResultHistory",
      { keyResultId: keyResult.id, limit: 100 },
    );
    expect(history.values.map((row) => row.value)).toEqual([55, 48, 41]);

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    // Read back as a number, not the string the driver returns for `numeric`.
    expect(read.keyResults[0]?.currentValue).toBe(55);
    expect(typeof read.keyResults[0]?.currentValue).toBe("number");
  });

  it("refuses a manual value on a KPI-linked key result", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Support cost per ticket",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 12,
        targetValue: 8,
        weight: 1,
        // KPIs arrive at P3-T12, so this is a plain uuid until then. The refusal
        // it drives is real either way.
        kpiId: "00000000-0000-4000-8000-0000000000aa",
      },
    );

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.recordValue", {
        id: keyResult.id,
        value: 9,
      }),
    ).rejects.toThrow(/reads its value from a KPI/i);

    await callAction({ pool: wb.appPool, ...context() }, "goals.unlinkKpi", {
      id: keyResult.id,
    });
    await callAction({ pool: wb.appPool, ...context() }, "goals.recordValue", {
      id: keyResult.id,
      value: 9,
    });

    const history = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.keyResultHistory",
      { keyResultId: keyResult.id, limit: 100 },
    );
    // Baseline, the frozen value at unlink, then the manual one.
    expect(history.values).toHaveLength(3);
    expect(history.values[0]?.value).toBe(9);
  });
});

describe("moving between cycles", () => {
  it("moves into a planning cycle and clears any timeframe", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const next = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.create",
      { on: "2026-11-15" } as never,
    );

    await callAction({ pool: wb.appPool, ...context() }, "goals.moveToCycle", {
      id: created.id,
      cycleId: (next as { id: string }).id,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.cycleId).toBe((next as { id: string }).id);
    expect(read.timeframe).toBeNull();
  });

  it("refuses a move into a closed cycle", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await wb.admin.query("update cycles set status = 'closed' where id = $1", [
      cycleId,
    ]);
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.moveToCycle", {
        id: created.id,
        cycleId,
      }),
    ).rejects.toThrow(/closing or closed/i);
  });
});

describe("the workflow snapshot now that goals exist", () => {
  it("makes gate 1 evaluable, and red when a goal has no title-holder pair", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    // A key result, because gate 4 has nothing to check on a goal with none, and
    // "nothing to check" and "cannot check" are different answers.
    await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
      goalId: created.id,
      title: "Raise activation from 41% to 60%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.read",
      { cycleId },
    );
    const gateOne = read.gates.find((gate) => gate.gateKey === 1);
    expect(gateOne?.evaluable).toBe(true);
    expect(gateOne?.passed).toBe(true);

    // Gate 4 was unevaluable here until P3-T09, because an empty list would have
    // claimed somebody had checked when the §5.4 register did not exist. It does
    // now, so an empty register is a real answer: this key result has no
    // dependencies, and there is nothing unconfirmed to block on.
    const gateFour = read.gates.find((gate) => gate.gateKey === 4);
    expect(gateFour?.evaluable).toBe(true);
    expect(gateFour?.passed).toBe(true);
  });

  it("reports gate 3 red for a goal with no parent and no contribution", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    // Clear the statement the factory does not set anyway, and confirm the gate
    // names the goal rather than reporting a count.
    await withTx(async (tx) => {
      await tx
        .update(goalsTable)
        .set({ contributionStatement: null })
        .where(eq(goalsTable.id, created.id));
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.read",
      { cycleId },
    );
    const gateThree = read.gates.find((gate) => gate.gateKey === 3);
    expect(gateThree?.evaluable).toBe(true);
    expect(gateThree?.passed).toBe(false);
    expect(gateThree?.missing[0]).toContain("Make mobile");
  });

  it("reports gate 5 red while a key result still exceeds capacity", async () => {
    const wb = await workerDb();
    const created = await createGoal({
      contributionStatement: "Carries the annual mobile thrust",
    });
    await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
      goalId: created.id,
      title: "Raise activation from 41% to 60%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
      capacity: "exceeds",
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.read",
      { cycleId },
    );
    const gateFive = read.gates.find((gate) => gate.gateKey === 5);
    expect(gateFive?.evaluable).toBe(true);
    expect(gateFive?.passed).toBe(false);
    expect(gateFive?.missing.join(" ")).toMatch(/exceeds capacity/);

    void keyResults;
  });
});

describe("the scoring cascade against real rows", () => {
  /**
   * The task's acceptance criteria (P3-T05), driven through the actions so the
   * derived columns are read back from the database rather than from the engine's
   * return value. The engine's own arithmetic is proved against the golden masters
   * in `packages/method`; what this file proves is that the rows agree.
   */
  it("scores a goal at eighty percent from key results weighted two and one", async () => {
    const wb = await workerDb();
    const created = await createGoal();

    // 100% and 40%, weighted 2 and 1. The plan's own example.
    const first = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Raise activation from 0 to 100",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 100,
        weight: 2,
      },
    );
    const second = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Cut cost per ticket from 0 to 100",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 0,
        targetValue: 100,
        weight: 1,
      },
    );

    await callAction({ pool: wb.appPool, ...context() }, "goals.recordValue", {
      id: first.id,
      value: 100,
    });
    await callAction({ pool: wb.appPool, ...context() }, "goals.recordValue", {
      id: second.id,
      value: 40,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.progressPct).toBe(80);
    expect(read.keyResults.find((kr) => kr.id === first.id)?.progressPct).toBe(
      100,
    );
    expect(read.keyResults.find((kr) => kr.id === second.id)?.progressPct).toBe(
      40,
    );
  });

  it("reads outdated for a stale goal, whatever its last status said", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    // Four days past due against the canon three-day grace. Check-ins arrive at
    // P3-T07, so the last status is not in play yet; the rule that matters here
    // is that staleness outranks whatever rule 3 would have said.
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '4 days' where id = $1",
      [created.id],
    );

    // Any write recomputes, so the staleness is picked up by the next one.
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: created.id,
      title: "Make mobile the way our customers prefer to reach us",
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.health).toBe("outdated");
  });

  it("rolls a child's progress into its parent", async () => {
    const wb = await workerDb();
    const parent = await createGoal({ title: "Parent" });
    await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
      goalId: parent.id,
      title: "Parent measure",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 100,
      weight: 1,
    });

    const child = await createGoal({
      title: "Child",
      parentGoalId: parent.id,
    });
    const childKeyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: child.id,
        title: "Child measure",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 100,
        weight: 1,
      },
    );
    await callAction({ pool: wb.appPool, ...context() }, "goals.recordValue", {
      id: childKeyResult.id,
      value: 100,
    });

    // The parent's own measure sits at 0, the child at 100, both weight 1.
    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: parent.id },
    );
    expect(read.progressPct).toBe(50);
  });

  it("writes a forecast that flags a decaying key result", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: created.id,
        title: "Raise activation from 0 to 100",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 100,
        weight: 1,
      },
    );

    // Three rising but decaying points. The status still looks fine; the forecast
    // is what says it will miss.
    for (const [days, value] of [
      [21, 0],
      [14, 10],
      [7, 12],
    ] as const) {
      await wb.admin.query(
        `insert into key_result_values (id, workspace_id, key_result_id, value, at, source)
         values (gen_random_uuid(), $1, $2, $3, now() - ($4 || ' days')::interval, 'manual')`,
        [workspaceId, keyResult.id, value, days],
      );
    }
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: created.id,
      title: "Make mobile the way our customers prefer to reach us",
    });

    const forecast = await wb.admin.query<{
      forecast: Record<string, unknown>;
    }>("select forecast from key_results where id = $1", [keyResult.id]);
    expect(forecast.rows[0]?.forecast).not.toBeNull();
    expect(forecast.rows[0]?.forecast?.trendingOffTrack).toBe(true);
  });
});

describe("the cadence on a goal", () => {
  /**
   * The wiring half of P3-T06. `test/cadence.test.ts` proves the arithmetic
   * against the golden masters with no database; this proves the four §8 events
   * that touch a row actually touch it.
   */
  it("stamps the first due date at creation, in the future", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    const row = await wb.admin.query<{ next_check_in_at: Date | null }>(
      "select next_check_in_at from goals where id = $1",
      [created.id],
    );
    const due = row.rows[0]?.next_check_in_at;
    expect(due).not.toBeNull();
    // Strictly after today: the anchor day is a deadline, and a goal created on
    // its own anchor day has not had a period to report on yet.
    expect(new Date(due as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("clears the due date on close and restarts it on reopen", async () => {
    const wb = await workerDb();
    const created = await createGoal();

    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: created.id,
      successStatus: "achieved",
      closeDecision: "keep",
      retrospectiveBody: richText("Landed."),
    });
    const closed = await wb.admin.query<{ next_check_in_at: Date | null }>(
      "select next_check_in_at from goals where id = $1",
      [created.id],
    );
    // A closed goal is never due, and a date left on it would make the sweep
    // report an archive as neglected.
    expect(closed.rows[0]?.next_check_in_at).toBeNull();

    await callAction({ pool: wb.appPool, ...context() }, "goals.reopen", {
      id: created.id,
    });
    const reopened = await wb.admin.query<{ next_check_in_at: Date | null }>(
      "select next_check_in_at from goals where id = $1",
      [created.id],
    );
    expect(reopened.rows[0]?.next_check_in_at).not.toBeNull();
    expect(
      new Date(reopened.rows[0]?.next_check_in_at as Date).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("restarts the rhythm when the frequency changes, never overdue", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '30 days' where id = $1",
      [created.id],
    );

    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: created.id,
      checkInFrequency: "monthly",
    });

    const row = await wb.admin.query<{ next_check_in_at: Date }>(
      "select next_check_in_at from goals where id = $1",
      [created.id],
    );
    // §8: a frequency change counts from today, so it never leaves a goal
    // instantly overdue.
    expect(
      new Date(row.rows[0]?.next_check_in_at as Date).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("sweeps a neglected goal to outdated, and is idempotent", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    // Past the canon three-day grace with nothing published.
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '9 days', health = 'on_track' where id = $1",
      [created.id],
    );

    const first = await inOperationForWorkspace(async (tx) =>
      sweepStaleness(tx, workspaceId, canonThresholds(), new Date()),
    );
    expect(first.flipped).toBe(1);

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.health).toBe("outdated");

    // A second run examines the same row and changes nothing.
    const second = await inOperationForWorkspace(async (tx) =>
      sweepStaleness(tx, workspaceId, canonThresholds(), new Date()),
    );
    expect(second.examined).toBe(1);
    expect(second.flipped).toBe(0);
  });

  it("leaves a goal inside its grace window alone", async () => {
    const wb = await workerDb();
    const created = await createGoal();
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '2 days', health = 'on_track' where id = $1",
      [created.id],
    );

    const swept = await inOperationForWorkspace(async (tx) =>
      sweepStaleness(tx, workspaceId, canonThresholds(), new Date()),
    );
    expect(swept.examined).toBe(0);
    expect(swept.flipped).toBe(0);
  });
});
