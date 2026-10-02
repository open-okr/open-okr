import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Bringing back what was deleted (completeness review M-13).
 *
 * Goals, initiatives, tasks and documents have been soft-deleted since each
 * shipped, and the delete control said "an administrator can bring it back"
 * while no action did. These are the four restores and the list an
 * administrator finds them on.
 *
 * What each restore must get right, and what each block below checks:
 *
 * | Must | Why |
 * |---|---|
 * | Bring back what the delete took with it | A goal without its key results is a measure of nothing |
 * | Refuse while a parent is still deleted, naming it | Otherwise it comes back somewhere nobody can open |
 * | Ask what the delete asked | Restoring is not a way round the access the delete needed |
 * | Leave an activity and an audit row | Undoing a delete is itself something somebody did |
 */

const OWNER = "restore-owner";
const OTHER = "restore-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
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

const addKeyResult = async (title: string, onGoal = goalId) => {
  const created = (await call("goals.addKeyResult", {
    goalId: onGoal,
    title,
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 0,
    targetValue: 100,
    weight: 1,
  })) as { id: string };
  return created.id;
};

const createGoal = async (title: string) =>
  (
    (await call("goals.create", {
      title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

/**
 * An initiative the owner holds `full` on, which is what deleting one needs.
 */
const createInitiative = async (input: Record<string, unknown> = {}) =>
  (await call("initiatives.create", {
    spaceId,
    title: "Rebuild the activation flow",
    ownerId: ownerMemberId,
    ...input,
  })) as { id: string };

/**
 * A task the owner holds `full` on, which is what deleting one needs.
 *
 * **Granted here, because nothing in the product grants it.** A task binds
 * `workspace_standard` at view, its space at edit and each assignee at edit,
 * so `tasks.delete` refuses every task made in the product today. That is
 * reported with this change rather than decided in it. The restore asks
 * exactly what the delete asks, so a test of the restore has to start from a
 * task somebody could have deleted.
 */
const grantFullOnTask = async (taskId: string) => {
  const wb = await workerDb();
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-full",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const context = await resolveSubjectContext(
          tx,
          "task",
          taskId,
          workspaceId,
        );
        const contextId = context?.contextId as string;
        const groupId = await ensureMemberGroup(tx, {
          workspaceId,
          memberId: ownerMemberId,
        });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId,
          level: ACCESS_LEVELS.full,
        });
        return {
          result: contextId,
          activity: {
            kind: "test.grant-full",
            subjectType: "task",
            subjectId: taskId,
          },
          audit: { action: "test.grant-full", targetType: "task" },
        };
      },
    },
  );
};

const createTask = async (input: Record<string, unknown> = {}) => {
  const created = (await call("tasks.create", {
    spaceId,
    title: "Draft the onboarding checklist",
    // Bo rather than the owner, so the owner's own group holds exactly the
    // one binding granted below.
    assigneeIds: [otherMemberId],
    ...input,
  })) as { id: string };
  await grantFullOnTask(created.id);
  return created;
};

const draftOnGoal = async (
  subjectType = "goal",
  subjectId = goalId,
  userId = OWNER,
) =>
  (await call(
    "documents.create",
    { subjectType, subjectId, title: "How we will win activation" },
    userId,
  )) as { id: string };

const audited = async (action: string, targetId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ actor_member_id: string | null }>(
    `select actor_member_id from audit_events
      where workspace_id = $1 and action = $2 and target_id = $3`,
    [workspaceId, action, targetId],
  );
  return rows;
};

const activity = async (kind: string, subjectId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    actor_member_id: string | null;
    payload: { title?: string };
  }>(
    `select actor_member_id, payload from activities
      where workspace_id = $1 and kind = $2 and subject_id = $3`,
    [workspaceId, kind, subjectId],
  );
  return rows;
};

const isDeleted = async (table: string, id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ deleted: boolean }>(
    `select deleted_at is not null as deleted from ${table} where id = $1`,
    [id],
  );
  return rows[0]?.deleted;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [OWNER, "restore-owner@example.com", OTHER, "restore-other@example.com"],
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

  goalId = await createGoal("Make activation the reason teams stay");
  firstKeyResult = await addKeyResult(
    "Weekly activation reaches sixty percent",
  );
  secondKeyResult = await addKeyResult("Time to first value falls to two days");

  const member = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Bo', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = member.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("goals.restore", () => {
  it("brings the goal back with the key results deleted with it", async () => {
    await call("goals.delete", { id: goalId });
    await expect(call("goals.read", { id: goalId })).rejects.toThrow(
      /No such goal/,
    );

    const restored = (await call("goals.restore", { id: goalId })) as {
      keyResults: number;
    };
    expect(restored.keyResults).toBe(2);

    const goal = (await call("goals.read", { id: goalId })) as {
      keyResults: { id: string }[];
    };
    expect(goal.keyResults.map((one) => one.id).sort()).toEqual(
      [firstKeyResult, secondKeyResult].sort(),
    );
  });

  it("leaves a key result that was gone before the goal was deleted", async () => {
    // No action removes one key result on its own, so the state is staged:
    // a key result stamped earlier than the goal did not go with it, and
    // bringing the goal back must not resurrect it.
    const wb = await workerDb();
    await wb.admin.query(
      `update key_results set deleted_at = now() - interval '1 day' where id = $1`,
      [secondKeyResult],
    );
    await call("goals.delete", { id: goalId });
    await call("goals.restore", { id: goalId });

    expect(await isDeleted("key_results", firstKeyResult)).toBe(false);
    expect(await isDeleted("key_results", secondKeyResult)).toBe(true);
  });

  it("records who restored it, in the feed and in the audit trail", async () => {
    await call("goals.delete", { id: goalId });
    await call("goals.restore", { id: goalId });

    const feed = await activity("goal.restored", goalId);
    expect(feed).toHaveLength(1);
    expect(feed[0]?.actor_member_id).toBe(ownerMemberId);
    expect(feed[0]?.payload.title).toBe(
      "Make activation the reason teams stay",
    );
    const trail = await audited("goals.restore", goalId);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.actor_member_id).toBe(ownerMemberId);
  });

  it("asks what the delete asked", async () => {
    await call("goals.delete", { id: goalId });

    // An ordinary member holds `edit` on the workspace, not `full`.
    await expect(call("goals.restore", { id: goalId }, OTHER)).rejects.toThrow(
      /higher access level/,
    );

    // **An administrator who is not the champion now clears both gates**
    // (P8-G13a). The Admin role grants manage on the goal domain, and a level
    // is the maximum over the bindings reaching somebody and the level their
    // role grants, so the second gate is met by the role rather than by a
    // binding on this goal. That is what the matrix says Admin may do, and it
    // answers the open question goals/service.ts recorded: before roles, a
    // workspace administrator could not touch a goal somebody else champions.
    await call("people.setAdministrator", {
      memberId: otherMemberId,
      administrator: true,
    });
    await call("goals.restore", { id: goalId }, OTHER);
    expect(await isDeleted("goals", goalId)).toBe(false);
  });

  it("is not held back by a deleted parent goal, which a delete leaves children under", async () => {
    // A goal is aligned to its parent rather than filed under it. Deleting the
    // parent leaves this child live and aligned where it was, so the restore
    // brings the child back to exactly that state rather than refusing it.
    const child = (
      (await call("goals.create", {
        title: "Halve the time to a first report",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
        weight: 1,
        parentGoalId: goalId,
      })) as { id: string }
    ).id;
    await call("goals.delete", { id: child });
    await call("goals.delete", { id: goalId });

    await call("goals.restore", { id: child });
    expect(await isDeleted("goals", child)).toBe(false);
    expect(await isDeleted("goals", goalId)).toBe(true);
  });

  it("refuses a goal that is not deleted, and says so", async () => {
    await expect(call("goals.restore", { id: goalId })).rejects.toThrow(
      /is not deleted/,
    );
  });
});

describe("initiatives.restore", () => {
  it("brings the initiative back with its links, and gate five counts it again", async () => {
    const created = await createInitiative({
      keyResultIds: [firstKeyResult, secondKeyResult],
      capacity: "exceeds",
    });
    await call("initiatives.delete", { id: created.id });

    const before = (await call("initiatives.capacity", { cycleId })) as {
      exceeds: boolean;
    };
    expect(before.exceeds).toBe(false);

    const restored = (await call("initiatives.restore", {
      id: created.id,
    })) as { links: number };
    expect(restored.links).toBe(2);

    const initiative = (await call("initiatives.read", { id: created.id })) as {
      keyResultIds: string[];
    };
    expect(initiative.keyResultIds.sort()).toEqual(
      [firstKeyResult, secondKeyResult].sort(),
    );
    const after = (await call("initiatives.capacity", { cycleId })) as {
      exceeds: boolean;
    };
    expect(after.exceeds).toBe(true);
  });

  it("records the restore in the feed and the audit trail", async () => {
    const created = await createInitiative();
    await call("initiatives.delete", { id: created.id });
    await call("initiatives.restore", { id: created.id });

    expect(await activity("initiative.restored", created.id)).toHaveLength(1);
    const trail = await audited("initiatives.restore", created.id);
    expect(trail[0]?.actor_member_id).toBe(ownerMemberId);
  });

  it("asks what the delete asked", async () => {
    // Somebody who is not the initiative's owner is told it does not exist,
    // by the delete and by the restore alike, administrator or not.
    const live = await createInitiative({ title: "A live one" });
    await expect(
      call("initiatives.delete", { id: live.id }, OTHER),
    ).rejects.toThrow(/No such initiative/);

    const created = await createInitiative();
    await call("initiatives.delete", { id: created.id });
    await expect(
      call("initiatives.restore", { id: created.id }, OTHER),
    ).rejects.toThrow(/No such initiative/);

    // An administrator clears both gates now, for the reason the goal case
    // above spells out: the Admin role grants manage on the initiative domain.
    await call("people.setAdministrator", {
      memberId: otherMemberId,
      administrator: true,
    });
    await call("initiatives.restore", { id: created.id }, OTHER);
    expect(await isDeleted("initiatives", created.id)).toBe(false);
  });
});

describe("tasks.restore", () => {
  it("brings the task back with its assignment and its checklist", async () => {
    const task = await createTask();
    await call("tasks.addChecklistItem", { id: task.id, title: "Write it" });
    await call("tasks.addChecklistItem", { id: task.id, title: "Ship it" });
    await call("tasks.delete", { id: task.id });
    await expect(call("tasks.read", { id: task.id })).rejects.toThrow(
      /No such task/,
    );

    await call("tasks.restore", { id: task.id });

    const read = (await call("tasks.read", { id: task.id })) as {
      assignees: { id: string }[];
      items: { title: string }[];
    };
    expect(read.assignees.map((one) => one.id)).toEqual([otherMemberId]);
    expect(read.items.map((one) => one.title)).toEqual(["Write it", "Ship it"]);
  });

  it("tells anybody watching the board that the card is back", async () => {
    const task = await createTask();
    await call("tasks.delete", { id: task.id });
    await call("tasks.restore", { id: task.id });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ payload: { change: string } }>(
      `select payload from outbox
        where topic = 'board.changed' and payload->>'taskId' = $1`,
      [task.id],
    );
    expect(rows.map((row) => row.payload.change)).toContain("restored");
  });

  it("refuses while its initiative is deleted, and names the initiative", async () => {
    const initiative = await createInitiative();
    const task = await createTask({ initiativeId: initiative.id });
    await call("tasks.delete", { id: task.id });
    await call("initiatives.delete", { id: initiative.id });

    await expect(call("tasks.restore", { id: task.id })).rejects.toThrow(
      /initiative "Rebuild the activation flow", which is deleted/,
    );
    expect(await isDeleted("tasks", task.id)).toBe(true);

    await call("initiatives.restore", { id: initiative.id });
    await call("tasks.restore", { id: task.id });
    expect(await isDeleted("tasks", task.id)).toBe(false);
  });

  it("records the restore, and asks what the delete asked", async () => {
    const task = await createTask();
    await call("tasks.delete", { id: task.id });
    // Bo is the assignee, which is edit on the task and not `full`, so the
    // restore answers him as the delete would have: no such task.
    await expect(call("tasks.restore", { id: task.id }, OTHER)).rejects.toThrow(
      /No such task/,
    );
    expect(await isDeleted("tasks", task.id)).toBe(true);

    await call("tasks.restore", { id: task.id });
    expect(await activity("task.restored", task.id)).toHaveLength(1);
    expect(await audited("tasks.restore", task.id)).toHaveLength(1);
  });
});

describe("documents.restore", () => {
  it("brings a document back onto its goal", async () => {
    const document = await draftOnGoal();
    await call("documents.delete", { id: document.id });
    await call("documents.restore", { id: document.id });

    const listed = (await call("documents.list", {
      subjectType: "goal",
      subjectId: goalId,
    })) as { id: string }[];
    expect(listed.map((one) => one.id)).toEqual([document.id]);
    expect(await activity("document.restored", document.id)).toHaveLength(1);
    expect(await audited("documents.restore", document.id)).toHaveLength(1);
  });

  it("refuses while its goal is deleted, and names the goal", async () => {
    const document = await draftOnGoal();
    await call("documents.delete", { id: document.id });
    await call("goals.delete", { id: goalId });

    await expect(
      call("documents.restore", { id: document.id }),
    ).rejects.toThrow(
      /goal "Make activation the reason teams stay", which is deleted/,
    );

    await call("goals.restore", { id: goalId });
    await call("documents.restore", { id: document.id });
    expect(await isDeleted("documents", document.id)).toBe(false);
  });

  it("finds a key result's goal even while the key result is gone", async () => {
    const document = await draftOnGoal("key_result", firstKeyResult);
    await call("documents.delete", { id: document.id });
    await call("goals.delete", { id: goalId });

    // Not a not-found: the key result went with its goal, and the goal's
    // context still answers who may restore what was on it.
    await expect(
      call("documents.restore", { id: document.id }),
    ).rejects.toThrow(/Restore the goal first/);
  });

  it("refuses an initiative's document while the initiative is deleted", async () => {
    const initiative = await createInitiative();
    const document = await draftOnGoal("initiative", initiative.id);
    await call("documents.delete", { id: document.id });
    await call("initiatives.delete", { id: initiative.id });

    await expect(
      call("documents.restore", { id: document.id }),
    ).rejects.toThrow(/Restore the initiative first/);
  });

  it("never restores somebody else's draft, and asks what the delete asked", async () => {
    await call("people.setAdministrator", {
      memberId: otherMemberId,
      administrator: true,
    });
    // On the cycle, which every member reaches at `edit` through the
    // workspace. Bo is in no space, so a goal in one is not his to write on.
    const theirs = await draftOnGoal("cycle", cycleId, OTHER);
    await call("documents.delete", { id: theirs.id }, OTHER);

    // A draft is its author's alone, deleted or not, so it answers exactly as
    // a document that never existed.
    await expect(call("documents.restore", { id: theirs.id })).rejects.toThrow(
      /No such document/,
    );

    await call("people.setAdministrator", {
      memberId: otherMemberId,
      administrator: false,
    });
    await expect(
      call("documents.restore", { id: theirs.id }, OTHER),
    ).rejects.toThrow(/higher access level/);
  });
});

describe("workspace.deletedItems", () => {
  const list = async (userId = OWNER) =>
    (
      (await call("workspace.deletedItems", {}, userId)) as {
        items: {
          subjectType: string;
          id: string;
          title: string;
          deletedBy: string | null;
        }[];
      }
    ).items;

  it("lists each kind, newest first, with who deleted it", async () => {
    const initiative = await createInitiative();
    const task = await createTask();
    const document = await draftOnGoal();

    await call("documents.delete", { id: document.id });
    await call("tasks.delete", { id: task.id });
    await call("initiatives.delete", { id: initiative.id });
    await call("goals.delete", { id: goalId });

    const items = await list();
    expect(items.map((item) => [item.subjectType, item.id])).toEqual([
      ["goal", goalId],
      ["initiative", initiative.id],
      ["task", task.id],
      ["document", document.id],
    ]);
    expect(new Set(items.map((item) => item.deletedBy))).toEqual(
      new Set(["Ada"]),
    );
  });

  it("drops a row once it is restored, and lists nothing live", async () => {
    const other = await createGoal("A goal nobody deleted");
    await call("goals.delete", { id: goalId });
    expect((await list()).map((item) => item.id)).toEqual([goalId]);

    await call("goals.restore", { id: goalId });
    const ids = (await list()).map((item) => item.id);
    expect(ids).not.toContain(goalId);
    expect(ids).not.toContain(other);
  });

  it("shows an administrator only what they could restore", async () => {
    await call("goals.delete", { id: goalId });
    await call("people.setAdministrator", {
      memberId: otherMemberId,
      administrator: true,
    });
    // An administrator, and not the goal's champion. Before roles they could
    // not have deleted it and so never saw it here; the Admin role grants
    // manage on the goal domain, so now they can restore it and it is on
    // their list. The list still shows only what the reader could restore,
    // which is the rule this test holds (P8-G13a).
    const shown = await list(OTHER);
    expect(shown.map((row) => row.id)).toEqual([goalId]);
  });

  it("is refused below full, as every read on an admin screen is", async () => {
    await expect(list(OTHER)).rejects.toThrow(/No such workspace/);
  });
});
