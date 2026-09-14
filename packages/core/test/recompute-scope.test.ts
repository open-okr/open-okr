import type { WorkspaceTx } from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import {
  recomputeForCycle,
  recomputeForGoal,
} from "../src/scoring/recompute.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * What one goal changing is allowed to recompute (P7-T02).
 *
 * `recomputeForGoal` used to load the changed goal's whole cycle. On §13.1's
 * dataset that is ten thousand goals for a change that can move a handful, and
 * publishing one check-in took 8.9 seconds and issued 20,034 statements.
 * Agung chose narrowing the scope on 10 September 2026, so it now loads the
 * goal, the goals above it, and the siblings each of those rolls up with.
 *
 * **The assertion that matters is the one that cannot be argued with.** A
 * narrower scope is only correct if it leaves the rows in the state a full
 * recompute would, so every test here runs the branch recompute and then a
 * cycle recompute over the same graph and requires the second one to write
 * nothing. It can only write nothing if the first got every value right, and
 * the last test proves the check can fail by breaking a value by hand first.
 */

const OWNER = "recompute-owner";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

/** Runs a helper on a real Operation transaction, the way a write path does. */
async function inOperation<T>(
  fn: (
    tx: Parameters<Parameters<typeof runOperation>[1]["execute"]>[0]["tx"],
  ) => Promise<T>,
): Promise<T> {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "test.recompute",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const result = await fn(tx);
        return {
          result,
          activity: {
            kind: "test.recompute",
            subjectType: "goal",
            subjectId: workspaceId,
          },
          audit: { action: "test.recompute", targetType: "goal" },
        };
      },
    },
  );
}

async function createGoal(
  title: string,
  overrides: Record<string, unknown> = {},
) {
  const wb = await workerDb();
  return (await callAction({ pool: wb.appPool, ...context() }, "goals.create", {
    title,
    cycleId,
    level: "team",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    ...overrides,
  } as never)) as { id: string };
}

/** A key result with a baseline of zero, so its progress is its own value. */
async function createKeyResult(goalId: string, current: number) {
  const wb = await workerDb();
  const created = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.addKeyResult",
    {
      goalId,
      title: `Reach ${current}`,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 0,
      targetValue: 100,
      currentValue: current,
    } as never,
  )) as { id: string };
  return created;
}

/** Every goal's stored progress and health, which is what a recompute writes. */
async function derived(): Promise<Record<string, string>> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{
    id: string;
    progress_pct: string;
    health: string;
  }>(
    "select id, progress_pct, health from goals where workspace_id = $1 order by id",
    [workspaceId],
  );
  return Object.fromEntries(
    rows.rows.map((row) => [row.id, `${row.progress_pct}/${row.health}`]),
  );
}

/**
 * A cycle recompute, and what it had to change.
 *
 * Zero written means the rows already held the answer, which is the whole
 * assertion: the recompute only writes a row whose derived values moved.
 */
async function cycleRecompute() {
  return inOperation((tx) =>
    recomputeForCycle(
      tx as unknown as WorkspaceTx,
      workspaceId,
      cycleId,
      canonThresholds(),
    ),
  );
}

async function branchRecompute(goalId: string) {
  return inOperation((tx) =>
    recomputeForGoal(
      tx as unknown as WorkspaceTx,
      workspaceId,
      goalId,
      canonThresholds(),
    ),
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Recompute Owner", "recompute-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Recompute Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const current = (await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" } as never,
  )) as { id: string };
  cycleId = current.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a change to one goal recomputes its branch and nothing else", () => {
  it("leaves the same values a whole-cycle recompute would, three levels up", async () => {
    // A tree with a sibling at every level, which is what makes a partial load
    // dangerous: an ancestor's progress is the weighted roll-up of children
    // this scope never loads in full.
    const top = await createGoal("Top");
    const middle = await createGoal("Middle", { parentGoalId: top.id });
    const middleSibling = await createGoal("Middle sibling", {
      parentGoalId: top.id,
    });
    const leaf = await createGoal("Leaf", { parentGoalId: middle.id });
    const leafSibling = await createGoal("Leaf sibling", {
      parentGoalId: middle.id,
    });

    await createKeyResult(leaf.id, 20);
    await createKeyResult(leafSibling.id, 80);
    await createKeyResult(middleSibling.id, 40);
    await createKeyResult(top.id, 10);

    // Settle everything, then move the leaf and recompute only its branch.
    await cycleRecompute();
    const leafKeyResult = await createKeyResult(leaf.id, 100);
    expect(leafKeyResult.id).toBeTruthy();
    await branchRecompute(leaf.id);
    const afterBranch = await derived();

    // The check: a full recompute now has nothing left to do.
    const sweep = await cycleRecompute();
    expect(sweep.goalsWritten).toBe(0);
    expect(sweep.keyResultsWritten).toBe(0);
    expect(await derived()).toEqual(afterBranch);
  });

  it("carries a change through a key-result alignment, not only a goal one", async () => {
    // A child aligned to a key result rolls into the goal that owns it
    // (decision D-2), so the walk upwards has to make that step too.
    const parent = await createGoal("Parent");
    const parentKeyResult = await createKeyResult(parent.id, 50);
    const child = await createGoal("Child", {
      parentKeyResultId: parentKeyResult.id,
    });
    await createKeyResult(child.id, 10);

    await cycleRecompute();
    await createKeyResult(child.id, 90);
    await branchRecompute(child.id);
    const afterBranch = await derived();

    const sweep = await cycleRecompute();
    expect(sweep.goalsWritten).toBe(0);
    expect(await derived()).toEqual(afterBranch);
  });

  it("writes nothing at all when the change moved no derived value", async () => {
    const goal = await createGoal("Unchanged");
    await createKeyResult(goal.id, 30);
    await cycleRecompute();

    const again = await branchRecompute(goal.id);
    expect(again.goalsWritten).toBe(0);
    expect(again.keyResultsWritten).toBe(0);
  });

  it("fails when a value is wrong, which is what makes the sweep meaningful", async () => {
    // The mutation that proves the assertion above can fail. Without it, a
    // recompute that wrote nothing under every condition would pass every
    // test in this file.
    const goal = await createGoal("Broken");
    await createKeyResult(goal.id, 30);
    await cycleRecompute();

    const wb = await workerDb();
    await wb.admin.query("update goals set progress_pct = '99' where id = $1", [
      goal.id,
    ]);
    const sweep = await cycleRecompute();
    expect(sweep.goalsWritten).toBe(1);
  });

  it("does not touch a goal outside the branch", async () => {
    // The other half of correctness: a narrower scope must also stop writing
    // rows it has no business in. `updated_at` used to be bumped on every goal
    // in the cycle every time anybody checked in anywhere.
    const parent = await createGoal("Parent");
    const changed = await createGoal("Changed", { parentGoalId: parent.id });
    const untouched = await createGoal("Untouched");
    await createKeyResult(changed.id, 10);
    await createKeyResult(untouched.id, 10);
    await cycleRecompute();

    const wb = await workerDb();
    const before = await wb.admin.query<{ updated_at: Date }>(
      "select updated_at from goals where id = $1",
      [untouched.id],
    );
    await createKeyResult(changed.id, 90);
    await branchRecompute(changed.id);
    const after = await wb.admin.query<{ updated_at: Date }>(
      "select updated_at from goals where id = $1",
      [untouched.id],
    );
    expect(after.rows[0]?.updated_at).toEqual(before.rows[0]?.updated_at);
  });
});

describe("a cycle scope still means the cycle", () => {
  it("recomputes every goal in it, aligned or not", async () => {
    const first = await createGoal("First");
    const second = await createGoal("Second");
    await createKeyResult(first.id, 25);
    await createKeyResult(second.id, 75);

    // Both are already settled, because adding a key result recomputes its
    // own branch. Breaking both by hand is what shows the cycle scope still
    // reaches a goal that nothing aligns to.
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set progress_pct = '3' where id = any($1::uuid[])",
      [[first.id, second.id]],
    );
    const swept = await cycleRecompute();
    expect(swept.goalsWritten).toBe(2);
    const values = await derived();
    expect(values[first.id]?.startsWith("25")).toBe(true);
    expect(values[second.id]?.startsWith("75")).toBe(true);
  });
});
