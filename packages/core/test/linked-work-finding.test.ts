import { withWorkspace } from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { sweepDivergenceInTx } from "../src/alignment/divergence.ts";
import type { OperationTx } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The linked-work finding reaches the Coach's inbox (TECHNICAL-PLAN.md §4.9,
 * P5-T14).
 *
 * Acceptance criterion:
 *   Given a key result whose linked tasks are all complete but whose measured
 *   value has not moved, when the Coach's divergence check runs, then it
 *   reports exactly that in the finding inbox, naming both figures.
 *
 * **The test plan's own two lines are the two that matter.** A goal with two
 * diverging key results produces two findings and dismissing one leaves the
 * other, which is what widening the finding identity was for. And the existing
 * per-goal findings still reconcile to one row each, which is what the widening
 * must not have broken.
 */

const OWNER = "finding-owner";

let workspaceId: string;
let ownerMemberId: string;
let spaceId: string;
let cycleId: string;
let goalId: string;
let firstKeyResult: string;
let secondKeyResult: string;

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    name as never,
    input as never,
  );
};

/** Runs the Coach's divergence sweep the way its own action does. */
const sweep = async () => {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, (rawTx) =>
    sweepDivergenceInTx(rawTx as unknown as OperationTx, {
      workspaceId,
      cycleId,
      thresholds: canonThresholds(),
    }),
  );
};

/** The open divergence findings, as the inbox reads them. */
const findings = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    subject_goal_id: string | null;
    subject_key_result_id: string | null;
    reason: string;
    state: string;
  }>(
    `select id, subject_goal_id, subject_key_result_id, reason, state
       from alignment_findings
      where workspace_id = $1 and kind = 'divergence' and deleted_at is null
      order by subject_key_result_id nulls first`,
    [workspaceId],
  );
  return rows;
};

const addKeyResult = async (title: string) =>
  (
    (await call("goals.addKeyResult", {
      goalId,
      title,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string }
  ).id;

/** One task on a key result, finished. */
const finishWorkOn = async (keyResultId: string, title: string) => {
  const task = (await call("tasks.create", {
    spaceId,
    title,
    keyResultId,
  })) as { id: string };
  await call("tasks.update", { id: task.id, status: "done" });
  return task.id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "finding-owner@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = cycle.id;

  const goal = (await call("goals.create", {
    title: "Make activation the reason teams stay",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

  firstKeyResult = await addKeyResult(
    "Weekly activation reaches sixty percent",
  );
  secondKeyResult = await addKeyResult("Time to first value falls to two days");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the finding the Coach raises about finished work", () => {
  it("acceptance: names the key result and both figures", async () => {
    await finishWorkOn(firstKeyResult, "Rewrite the first-run screen");
    await sweep();

    const open = await findings();
    const linked = open.find(
      (row) => row.subject_key_result_id === firstKeyResult,
    );
    expect(linked).toBeDefined();
    // The goal is still named, so every surface that reads findings by goal
    // keeps working.
    expect(linked?.subject_goal_id).toBe(goalId);
    expect(linked?.reason).toContain("1 of 1 linked task complete");
    expect(linked?.reason).toContain("41");
  });

  it("says nothing while any of the work is unfinished", async () => {
    const task = (await call("tasks.create", {
      spaceId,
      title: "Rewrite the first-run screen",
      keyResultId: firstKeyResult,
    })) as { id: string };
    expect(task.id.length).toBeGreaterThan(0);

    await sweep();
    expect(
      (await findings()).filter((row) => row.subject_key_result_id !== null),
    ).toEqual([]);
  });

  it("says nothing about a key result with no work behind it", async () => {
    await sweep();
    expect(
      (await findings()).filter((row) => row.subject_key_result_id !== null),
    ).toEqual([]);
  });

  it("clears the finding once the measure moves", async () => {
    await finishWorkOn(firstKeyResult, "Rewrite the first-run screen");
    await sweep();
    expect(
      (await findings()).filter((row) => row.subject_key_result_id !== null),
    ).toHaveLength(1);

    await call("goals.recordValue", { id: firstKeyResult, value: 42 });
    await sweep();
    // A condition that cleared soft-deletes its row rather than flipping to a
    // closed state, which is the rule `reconcileFindingsInTx` already holds.
    expect(
      (await findings()).filter((row) => row.subject_key_result_id !== null),
    ).toEqual([]);
  });
});

describe("test plan: two measures, two findings, two decisions", () => {
  it("raises one per diverging key result rather than one per goal", async () => {
    await finishWorkOn(firstKeyResult, "Rewrite the first-run screen");
    await finishWorkOn(secondKeyResult, "Cut the onboarding steps");
    await sweep();

    const linked = (await findings()).filter(
      (row) => row.subject_key_result_id !== null,
    );
    expect(linked).toHaveLength(2);
    expect(linked.map((row) => row.subject_key_result_id).sort()).toEqual(
      [firstKeyResult, secondKeyResult].sort(),
    );
    // Both name the same goal, which is exactly the collision the old identity
    // could not survive.
    expect(new Set(linked.map((row) => row.subject_goal_id)).size).toBe(1);
  });

  it("dismissing one leaves the other, and a later sweep respects it", async () => {
    await finishWorkOn(firstKeyResult, "Rewrite the first-run screen");
    await finishWorkOn(secondKeyResult, "Cut the onboarding steps");
    await sweep();

    const [dismissed] = (await findings()).filter(
      (row) => row.subject_key_result_id === firstKeyResult,
    );
    // Through the action rather than an UPDATE: the table's own constraint
    // refuses a decision with nobody attached to it, which is the point of
    // recording who dismissed a finding.
    await call("alignment.dismissFinding", { id: dismissed?.id });

    await sweep();
    const after = await findings();
    // The dismissal survives the next sweep, which is one of the four rules
    // `reconcileFindingsInTx` exists to hold.
    expect(
      after.find((row) => row.subject_key_result_id === firstKeyResult)?.state,
    ).toBe("dismissed");
    expect(
      after.find((row) => row.subject_key_result_id === secondKeyResult)?.state,
    ).toBe("open");
  });
});

describe("test plan: the existing per-goal findings are unchanged", () => {
  it("still reconciles §6.1's own cases to one row per goal", async () => {
    const wb = await workerDb();
    // A goal reported healthy while its own progress says otherwise, which is
    // §6.1's first case and has nothing to do with tasks.
    await wb.admin.query(
      "update goals set health = 'on_track', progress_pct = 5 where id = $1",
      [goalId],
    );
    await wb.admin.query(
      "update key_results set confidence = 0.2 where goal_id = $1",
      [goalId],
    );

    await sweep();
    const perGoal = (await findings()).filter(
      (row) => row.subject_key_result_id === null,
    );
    // One, not two, even though both of §6.1's cases may hold: they say the
    // same thing to a facilitator and two rows would need two dismissals.
    expect(perGoal).toHaveLength(1);
    expect(perGoal[0]?.subject_goal_id).toBe(goalId);
  });

  it("lets a per-goal finding and a per-key-result one sit side by side", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set health = 'on_track', progress_pct = 5 where id = $1",
      [goalId],
    );
    await wb.admin.query(
      "update key_results set confidence = 0.2 where goal_id = $1",
      [goalId],
    );
    await finishWorkOn(firstKeyResult, "Rewrite the first-run screen");

    await sweep();
    const open = await findings();
    expect(
      open.filter((row) => row.subject_key_result_id === null),
    ).toHaveLength(1);
    expect(
      open.filter((row) => row.subject_key_result_id !== null),
    ).toHaveLength(1);
  });
});
