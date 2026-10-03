import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { errorFor, statusFor } from "../src/api/errors.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * One tree, and one-field writes that refuse a stale read (P9-T06a,
 * docs/design/p9-t00-okr-writing.md §6).
 *
 * The tree answers what both OKR views draw in one call, including the annual
 * objective a quarter hangs under. A patch carries the values it read and is
 * refused, with what is stored now and who changed it, when one of the fields
 * it changes has moved. A field it does not change, or a number recomputed
 * underneath it, never makes it fail.
 */

const OWNER = "tree-owner";
const EDITOR = "tree-editor";

let workspaceId: string;
let ownerMemberId: string;
let editorMemberId: string;
let quarterId: string;
let annualId: string;

async function call<T>(
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

/** A colleague who edits OKRs and administers none of them. */
async function addEditor(): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [EDITOR, "Mei Editor", `${EDITOR}@example.com`],
  );
  const inserted = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Mei Editor', 'human', 'active')
     returning id`,
    [workspaceId, EDITOR],
  );
  const memberId = inserted.rows[0]?.id as string;
  // The built-in Member role, which edits OKRs and administers none of them
  // (P8-G13a), as an invited colleague holds.
  const { roles } = await call<{
    roles: { id: string; builtinKey: string | null }[];
  }>(OWNER, "roles.list", {});
  const role = roles.find((entry) => entry.builtinKey === "member");
  await call(OWNER, "roles.assign", { memberId, roleId: role?.id });
  return memberId;
}

async function objective(
  title: string,
  cycleId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const goal = await call<{ id: string }>(OWNER, "goals.create", {
    title,
    cycleId,
    level: "team",
    ownerKind: "workspace",
    championId: ownerMemberId,
    ...extra,
  });
  return goal.id;
}

async function keyResult(
  goalId: string,
  title: string,
  ownerId?: string,
): Promise<string> {
  const created = await call<{ id: string }>(OWNER, "goals.addKeyResult", {
    goalId,
    title,
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 0,
    targetValue: 100,
    ...(ownerId ? { ownerId } : {}),
  });
  return created.id;
}

interface TreeGoal {
  id: string;
  title: string;
  weight: number;
  champion: { id: string; name: string };
  parentGoalId: string | null;
  keyResults: {
    id: string;
    title: string;
    owner: { id: string; name: string } | null;
    baselineValue: number;
    dueOn: string | null;
  }[];
}

interface Tree {
  goals: TreeGoal[];
  context: { id: string; otherCycle: boolean; cycleName: string | null }[];
  dependencies: { fromGoalId: string; toGoalId: string }[];
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Priya Owner", "tree-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Priya Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  editorMemberId = await addEditor();

  // Two years out, so the quarter and its year are both made here.
  const year = new Date().getUTCFullYear() + 2;
  annualId = (
    await call<{ id: string }>(OWNER, "cycles.create", {
      on: `${year}-05-15`,
      mode: "annual",
    })
  ).id;
  quarterId = (
    await call<{ id: string }>(OWNER, "cycles.create", {
      on: `${year}-05-15`,
      mode: "quarterly",
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("goals.tree", () => {
  it("returns the cycle's objectives with their key results and owners, and the annual parent as context", async () => {
    const annual = await objective(
      "Become the default for small teams",
      annualId,
      {
        level: "company",
      },
    );
    const team = await objective(
      "Make onboarding the reason teams stay",
      quarterId,
      {
        parentGoalId: annual,
      },
    );
    await keyResult(team, "Activation from 30% to 45%", editorMemberId);
    await objective("Something in another quarter", annualId);

    const tree = await call<Tree>(OWNER, "goals.tree", { cycleId: quarterId });
    expect(tree.goals.map((goal) => goal.id)).toEqual([team]);
    const [node] = tree.goals;
    expect(node?.parentGoalId).toBe(annual);
    expect(node?.keyResults[0]?.owner).toEqual({
      id: editorMemberId,
      name: "Mei Editor",
    });
    expect(tree.context).toEqual([
      expect.objectContaining({ id: annual, otherCycle: true }),
    ]);
    expect(tree.context[0]?.cycleName).toBeTruthy();
  });

  it("narrows to mine: what the reader champions, reviews or owns a key result under", async () => {
    const owned = await objective("Owned through a key result", quarterId);
    await keyResult(owned, "Ship the import wizard", editorMemberId);
    await objective("Nothing to do with the editor", quarterId);

    const mine = await call<Tree>(EDITOR, "goals.tree", {
      cycleId: quarterId,
      scope: "mine",
    });
    expect(mine.goals.map((goal) => goal.id)).toEqual([owned]);
  });

  it("returns dependencies between objectives it draws", async () => {
    const one = await objective("Faster support answers", quarterId);
    const two = await objective("Fewer tickets per account", quarterId);
    await call(OWNER, "goals.addDependency", {
      fromGoalId: one,
      toGoalId: two,
    });

    const tree = await call<Tree>(OWNER, "goals.tree", { cycleId: quarterId });
    expect(tree.dependencies).toHaveLength(1);
    expect(
      [tree.dependencies[0]?.fromGoalId, tree.dependencies[0]?.toGoalId].sort(),
    ).toEqual([one, two].sort());
  });

  it("refuses a cycle that does not exist", async () => {
    await expect(
      call(OWNER, "goals.tree", {
        cycleId: "00000000-0000-7000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("goals.patch", () => {
  it("changes a field and hands back the recomputed node", async () => {
    const id = await objective("Grow the trial base", quarterId);
    const patched = await call<{ goal: TreeGoal }>(OWNER, "goals.patch", {
      id,
      set: { title: "Make trials turn into teams" },
      read: { title: "Grow the trial base" },
    });
    expect(patched.goal.title).toBe("Make trials turn into teams");
  });

  it("refuses a write made from a stale read, with the stored value and who changed it", async () => {
    const id = await objective("Grow the trial base", quarterId);
    await call(EDITOR, "goals.patch", {
      id,
      set: { title: "Mei's title" },
      read: { title: "Grow the trial base" },
    });

    const refused = call(OWNER, "goals.patch", {
      id,
      set: { title: "Priya's title" },
      read: { title: "Grow the trial base" },
    });
    await expect(refused).rejects.toMatchObject({
      code: "conflict",
      details: {
        current: { title: "Mei's title" },
        changedBy: "Mei Editor",
      },
    });
    await expect(refused).rejects.toThrow(/Mei Editor changed this/);

    const tree = await call<Tree>(OWNER, "goals.tree", { cycleId: quarterId });
    expect(tree.goals[0]?.title).toBe("Mei's title");
  });

  it("does not conflict over a field it does not change", async () => {
    const id = await objective("Grow the trial base", quarterId);
    await call(EDITOR, "goals.patch", {
      id,
      set: { weight: 2 },
      read: { weight: 1 },
    });
    const patched = await call<{ goal: TreeGoal }>(OWNER, "goals.patch", {
      id,
      set: { title: "Make trials turn into teams" },
      read: { title: "Grow the trial base" },
    });
    expect(patched.goal).toMatchObject({
      title: "Make trials turn into teams",
      weight: 2,
    });
  });

  it("does not conflict because a value was recorded underneath it", async () => {
    const id = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(id, "Trials from 100 to 300");
    await call(OWNER, "goals.recordValue", { id: kr, value: 50 });
    await expect(
      call(OWNER, "goals.patch", {
        id,
        set: { title: "Make trials turn into teams" },
        read: { title: "Grow the trial base" },
      }),
    ).resolves.toBeTruthy();
  });

  it("asks for the value read for every field it changes", async () => {
    const id = await objective("Grow the trial base", quarterId);
    await expect(
      call(OWNER, "goals.patch", { id, set: { title: "New" }, read: {} }),
    ).rejects.toThrow(/value you read/);
  });

  it("moves the champion only for somebody who may administer the goal", async () => {
    const id = await objective("Grow the trial base", quarterId);
    await expect(
      call(EDITOR, "goals.patch", {
        id,
        set: { championId: editorMemberId },
        read: { championId: ownerMemberId },
      }),
    ).rejects.toBeTruthy();

    const moved = await call<{ goal: TreeGoal }>(OWNER, "goals.patch", {
      id,
      set: { championId: editorMemberId },
      read: { championId: ownerMemberId },
    });
    expect(moved.goal.champion).toEqual({
      id: editorMemberId,
      name: "Mei Editor",
    });
  });
});

describe("goals.patchKeyResult", () => {
  it("changes several fields at once and compares numbers by value", async () => {
    const id = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(id, "Trials from 100 to 300");
    const patched = await call<{ goal: TreeGoal }>(
      OWNER,
      "goals.patchKeyResult",
      {
        id: kr,
        set: { title: "Trials from 100 to 400", baselineValue: 100 },
        // The baseline is stored as a decimal; 0 read is 0 stored.
        read: { title: "Trials from 100 to 300", baselineValue: 0 },
      },
    );
    expect(patched.goal.keyResults[0]).toMatchObject({
      title: "Trials from 100 to 400",
      baselineValue: 100,
    });
  });

  it("refuses a stale due date and keeps the stored one", async () => {
    const id = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(id, "Trials from 100 to 300");
    await call(EDITOR, "goals.patchKeyResult", {
      id: kr,
      set: { dueOn: "2030-03-31" },
      read: { dueOn: null },
    });
    await expect(
      call(OWNER, "goals.patchKeyResult", {
        id: kr,
        set: { dueOn: "2030-02-28" },
        read: { dueOn: null },
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: { current: { dueOn: "2030-03-31" } },
    });
  });

  it("does not take the target, which has its own action", async () => {
    const id = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(id, "Trials from 100 to 300");
    await expect(
      call(OWNER, "goals.patchKeyResult", {
        id: kr,
        set: { targetValue: 50 },
        read: { targetValue: 100 },
      }),
    ).rejects.toBeTruthy();
  });
});

describe("a conflict on the public surfaces", () => {
  it("is 409, with what is stored now", () => {
    const error = errorFor(
      new OperationError("conflict", "Changed since you read it.", {
        current: { title: "Mei's title" },
        changedBy: "Mei Editor",
      }),
    );
    expect(error).toMatchObject({
      code: "conflict",
      details: { current: { title: "Mei's title" } },
    });
    expect(statusFor(error.code)).toBe(409);
  });
});
