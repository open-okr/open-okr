import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Live or draft, under "Live" (METHOD.md §2.9, P9-T13-b-a).
 *
 * An objective or a key result added mid-cycle is live as soon as it passes
 * the checks set to block, and until then a draft its space can see, with
 * what is missing named. A key result may be saved before its target is
 * known; it reads no progress until it is, and its first target asks for no
 * reason because it eases nothing.
 */

const OWNER = "live-draft-owner";
const TEAMMATE = "live-draft-teammate";

let workspaceId: string;
let ownerMemberId: string;
let teammateMemberId: string;
let cycleId: string;
let spaceId: string;

async function callAs<T>(
  userId: string,
  action: string,
  input: unknown,
): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    action as never,
    input as never,
  )) as T;
}

const call = <T>(action: string, input: unknown) =>
  callAs<T>(OWNER, action, input);

/** The quarter, `daysAgo` days in and published, as NW-Q3 finds it. */
async function cycleStarted(daysAgo: number) {
  const wb = await workerDb();
  await wb.admin.query(
    `update cycles
        set starts_on = current_date - $2::int,
            ends_on = current_date + 30,
            published_at = now()
      where id = $1`,
    [cycleId, daysAgo],
  );
}

interface Draft {
  missing: string[];
  failing: string[];
}

interface TreeKeyResult {
  id: string;
  targetValue: number | null;
  progressPct: number;
  draft: Draft | null;
}

interface TreeGoal {
  id: string;
  draft: Draft | null;
  keyResults: TreeKeyResult[];
}

async function treeGoal(goalId: string, userId = OWNER): Promise<TreeGoal> {
  const tree = await callAs<{ goals: TreeGoal[] }>(userId, "goals.tree", {
    cycleId,
    scope: "all",
  });
  const goal = tree.goals.find((entry) => entry.id === goalId);
  if (!goal) {
    throw new Error("The goal is not in the tree.");
  }
  return goal;
}

/** NW-Q3-09's G1, in the Growth space. */
async function growthObjective() {
  return (
    await call<{ id: string }>("goals.create", {
      title: "Make self-serve a second engine of growth",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
    })
  ).id;
}

/** NW-Q3-11's G1.2, with whatever of its target is known. */
async function conversion(goalId: string, extra: Record<string, unknown>) {
  return (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Self-serve trial-to-paid conversion from 4.1% to 7%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 4.1,
      dueOn: "2026-09-30",
      ownerId: ownerMemberId,
      ...extra,
    })
  ).id;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Yuki Owner",
      `${OWNER}@example.com`,
      TEAMMATE,
      "Amara Teammate",
      `${TEAMMATE}@example.com`,
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Yuki Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  spaceId = (await call<{ id: string }>("spaces.create", { name: "Growth" }))
    .id;

  const teammate = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Amara Teammate', 'active',
             (select id from workspace_roles
               where workspace_id = $1 and is_default and deleted_at is null))
     returning id`,
    [workspaceId, TEAMMATE],
  );
  teammateMemberId = teammate.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: teammateMemberId,
    role: "member",
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a key result added mid-cycle", () => {
  it("acceptance: without a target it is a draft its space can see, naming the target, and goes live when the target is added", async () => {
    await cycleStarted(35);
    const goalId = await growthObjective();
    const keyResultId = await conversion(goalId, {});

    const seen = await treeGoal(goalId, TEAMMATE);
    const draft = seen.keyResults.find((entry) => entry.id === keyResultId);
    expect(draft).toMatchObject({
      targetValue: null,
      draft: { missing: ["target"], failing: [] },
    });

    await call("goals.changeTarget", { id: keyResultId, targetValue: 7 });
    const live = (await treeGoal(goalId, TEAMMATE)).keyResults.find(
      (entry) => entry.id === keyResultId,
    );
    expect(live).toMatchObject({ targetValue: 7, draft: null });
  });

  it("is live at once with its target, due date and owner (NW-Q3-11)", async () => {
    await cycleStarted(35);
    const goalId = await growthObjective();
    const keyResultId = await conversion(goalId, { targetValue: 7 });
    expect(
      (await treeGoal(goalId)).keyResults.find(
        (entry) => entry.id === keyResultId,
      )?.draft,
    ).toBeNull();
  });

  it("names everything KR-3 found missing", async () => {
    await cycleStarted(35);
    const goalId = await growthObjective();
    const keyResultId = (
      await call<{ id: string }>("goals.addKeyResult", {
        goalId,
        title: "Self-serve trial-to-paid conversion from 4.1% to 7%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 4.1,
      })
    ).id;
    expect(
      (await treeGoal(goalId)).keyResults.find(
        (entry) => entry.id === keyResultId,
      )?.draft,
    ).toEqual({ missing: ["target", "dueDate", "owner"], failing: [] });
  });

  it("is never a draft while it is the plan, though KR-3 still flags it", async () => {
    await cycleStarted(10);
    const goalId = await growthObjective();
    const keyResultId = await conversion(goalId, {});
    const keyResult = (await treeGoal(goalId)).keyResults.find(
      (entry) => entry.id === keyResultId,
    ) as TreeKeyResult & { qualityFlags: string[] };
    expect(keyResult.draft).toBeNull();
    expect(keyResult.qualityFlags).toContain("KR-3");
  });
});

describe("an objective added mid-cycle", () => {
  it("is a draft until its first key result, then live (NW-Q3-09)", async () => {
    await cycleStarted(35);
    const goalId = await growthObjective();
    expect((await treeGoal(goalId)).draft).toEqual({
      missing: ["keyResult"],
      failing: [],
    });

    await call("goals.addKeyResult", {
      goalId,
      kind: "baseline",
      title: "Establish the self-serve trial-to-paid rate",
      indicatorType: "lagging",
      dueOn: "2026-08-23",
      ownerId: teammateMemberId,
    });
    expect((await treeGoal(goalId)).draft).toBeNull();
  });
});

describe("a target that waits", () => {
  it("reads no progress, whatever value is recorded, until it is set", async () => {
    await cycleStarted(35);
    const goalId = await growthObjective();
    const keyResultId = await conversion(goalId, {});
    await call("goals.recordValue", { id: keyResultId, value: 5.2 });
    const before = (await treeGoal(goalId)).keyResults.find(
      (entry) => entry.id === keyResultId,
    );
    expect(before?.progressPct).toBe(0);

    await call("goals.changeTarget", { id: keyResultId, targetValue: 7 });
    const after = (await treeGoal(goalId)).keyResults.find(
      (entry) => entry.id === keyResultId,
    );
    // (5.2 - 4.1) / (7 - 4.1), so 38% once there is something to move toward.
    expect(after?.progressPct).toBeCloseTo(37.93, 1);
  });

  it("asks no reason for its first target, and keeps no history of a target that never was", async () => {
    await cycleStarted(35);
    await call("practice.update", {
      overrides: { "reasons.easingTarget": "required" },
    });
    const goalId = await growthObjective();
    const keyResultId = await conversion(goalId, {});
    const change = await call<{ change: { from: number | null } }>(
      "goals.changeTarget",
      { id: keyResultId, targetValue: 3 },
    );
    expect(change.change.from).toBeNull();
    const history = await call<{ changes: unknown[] }>("goals.targetHistory", {
      id: keyResultId,
    });
    expect(history.changes).toEqual([]);
  });
});
