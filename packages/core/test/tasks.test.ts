import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Tasks, the board's ordering, and the signal that must never become progress
 * (TECHNICAL-PLAN §4.9, P5-T11).
 *
 * The task's own test plan, in order:
 *   - two simultaneous reorders converge with no lost or duplicated cards
 *   - the derived linked-work signal never overwrites the measured key result
 *     value
 *   - assignment notifies everyone except the actor
 *
 * **The first describe block is the one that matters most.** A product that let
 * a full board turn a key result green would be teaching teams to measure
 * activity instead of outcomes, which is the work-layer design's §1 and the
 * reason the product exists.
 */

const OWNER = "task-owner";
const OTHER = "task-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let spaceId: string;
let cycleId: string;
let goalId: string;
let keyResultId: string;

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

const createTask = async (title: string, extra: Record<string, unknown> = {}) =>
  (await call("tasks.create", { spaceId, title, ...extra })) as {
    id: string;
    title: string;
  };

/** The `todo` column, in the order the board draws it. */
const column = async (status = "todo") => {
  const board = (await call("tasks.board", { spaceId })) as {
    columns: { status: string; cards: { id: string; title: string }[] }[];
  };
  return board.columns.find((one) => one.status === status)?.cards ?? [];
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [OWNER, "task-owner@example.com", OTHER, "task-other@example.com"],
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

  const keyResult = (await call("goals.addKeyResult", {
    goalId,
    title: "Weekly activation reaches sixty per cent",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 41,
    targetValue: 60,
    weight: 1,
  })) as { id: string };
  keyResultId = keyResult.id;

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

describe("what finishing work does to a key result, which is nothing", () => {
  it("leaves the measured value and its progress exactly where they were", async () => {
    const task = await createTask("Rewrite the first-run screen", {
      keyResultId,
    });
    await call("tasks.update", { id: task.id, status: "done" });

    const goal = (await call("goals.read", { id: goalId })) as {
      keyResults: { id: string; progressPct: number; currentValue: number }[];
    };
    const measured = goal.keyResults.find((one) => one.id === keyResultId);
    expect(measured?.currentValue).toBe(41);
    expect(measured?.progressPct).toBe(0);
  });

  it("shows the two numbers side by side and never adds them", async () => {
    const first = await createTask("One", { keyResultId });
    await createTask("Two", { keyResultId });
    await call("tasks.update", { id: first.id, status: "done" });

    const [rail] = (await call("tasks.linkedWork", { cycleId })) as {
      progressPct: number;
      linkedWork: { done: number; total: number };
      divergence: string | null;
    }[];
    expect(rail?.linkedWork).toEqual({ done: 1, total: 2 });
    // The measured progress is its own number and is untouched by the other.
    expect(rail?.progressPct).toBe(0);
    // Nothing is said while work is unfinished.
    expect(rail?.divergence).toBeNull();
  });

  it("acceptance: reports the divergence, naming both figures", async () => {
    const first = await createTask("One", { keyResultId });
    const second = await createTask("Two", { keyResultId });
    for (const task of [first, second]) {
      await call("tasks.update", { id: task.id, status: "done" });
    }

    const [rail] = (await call("tasks.linkedWork", { cycleId })) as {
      linkedWork: { done: number; total: number };
      divergence: string | null;
    }[];
    expect(rail?.linkedWork).toEqual({ done: 2, total: 2 });
    expect(rail?.divergence).toContain("2 of 2 linked tasks complete");
    expect(rail?.divergence).toContain("41");
  });

  it("stops saying it the moment the measure moves", async () => {
    const task = await createTask("One", { keyResultId });
    await call("tasks.update", { id: task.id, status: "done" });
    await call("goals.recordValue", { id: keyResultId, value: 42 });

    const [rail] = (await call("tasks.linkedWork", { cycleId })) as {
      divergence: string | null;
    }[];
    expect(rail?.divergence).toBeNull();
  });
});

describe("ordering, and the problem it actually solves", () => {
  it("appends a new card at the end of its column", async () => {
    const first = await createTask("First", { status: "todo" });
    const second = await createTask("Second", { status: "todo" });
    expect((await column()).map((card) => card.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("moves a card to the top when it lands after nothing", async () => {
    const first = await createTask("First", { status: "todo" });
    const second = await createTask("Second", { status: "todo" });
    await call("tasks.move", { id: second.id, status: "todo" });
    expect((await column()).map((card) => card.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("acceptance: two simultaneous reorders converge, losing and duplicating nothing", async () => {
    const cards = [];
    for (const title of ["A", "B", "C", "D"]) {
      cards.push(await createTask(title, { status: "todo" }));
    }
    const [a, b, c, d] = cards as { id: string }[];

    // Both moves are issued at once. Each opens its own Operation and therefore
    // its own transaction, so the row lock inside `moveTaskInTx` is the only
    // thing making them serialise. Without it both read the same neighbours and
    // one move is lost or two cards share a slot.
    await Promise.all([
      call("tasks.move", {
        id: (d as { id: string }).id,
        status: "todo",
        afterTaskId: (a as { id: string }).id,
      }),
      call("tasks.move", {
        id: (c as { id: string }).id,
        status: "todo",
        afterTaskId: (a as { id: string }).id,
      }),
    ]);

    const after = await column();
    const ids = after.map((card) => card.id);
    // Nothing lost.
    expect(ids).toHaveLength(4);
    // Nothing duplicated.
    expect(new Set(ids).size).toBe(4);
    // Every card still there, whatever order the two moves settled on.
    expect(ids.sort()).toEqual(
      [
        (a as { id: string }).id,
        (b as { id: string }).id,
        (c as { id: string }).id,
        (d as { id: string }).id,
      ].sort(),
    );
    // And the positions are distinct, which is what "share a slot" would break.
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ position: number }>(
      `select position from tasks
        where workspace_id = $1 and status = 'todo' and deleted_at is null`,
      [workspaceId],
    );
    expect(new Set(rows.map((row) => row.position)).size).toBe(4);
  });

  it("renumbers the column when the gap closes, in the same read", async () => {
    const first = await createTask("First", { status: "todo" });
    const second = await createTask("Second", { status: "todo" });
    const wb = await workerDb();
    // Force the two neighbours one apart, which is the state a hundred drags
    // would reach. The next insertion between them has nowhere to go.
    await wb.admin.query("update tasks set position = 10 where id = $1", [
      first.id,
    ]);
    await wb.admin.query("update tasks set position = 11 where id = $1", [
      second.id,
    ]);
    const third = await createTask("Third", { status: "todo" });

    const outcome = (await call("tasks.move", {
      id: third.id,
      status: "todo",
      afterTaskId: first.id,
    })) as { normalised: boolean };

    expect(outcome.normalised).toBe(true);
    expect((await column()).map((card) => card.title)).toEqual([
      "First",
      "Third",
      "Second",
    ]);
  });

  it("lands a card at the end when the card it was dropped after has gone", async () => {
    const first = await createTask("First", { status: "todo" });
    const second = await createTask("Second", { status: "todo" });
    await call("tasks.move", { id: first.id, status: "done" });

    // The neighbour moved columns between the drag starting and landing, which
    // is what two people working at once looks like. Refusing would throw away
    // a real drag; guessing a slot would be worse.
    const outcome = (await call("tasks.move", {
      id: second.id,
      status: "todo",
      afterTaskId: first.id,
    })) as { position: number };
    expect(outcome.position).toBeGreaterThan(0);
    expect((await column()).map((card) => card.id)).toEqual([second.id]);
  });
});

describe("assignment, which is an access change", () => {
  it("gives the assignee edit on that task and nothing else", async () => {
    const task = await createTask("Rewrite the first-run screen");
    await call("tasks.assign", { id: task.id, memberId: otherMemberId });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ level: number }>(
      `select b.level from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'task'
          and c.resource_id = $1
          and g.kind = 'member'
          and g.member_id = $2
          and b.deleted_at is null`,
      [task.id, otherMemberId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe(70);
  });

  it("takes the access back when the assignment is removed", async () => {
    const task = await createTask("Rewrite the first-run screen");
    await call("tasks.assign", { id: task.id, memberId: otherMemberId });
    await call("tasks.unassign", { id: task.id, memberId: otherMemberId });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ count: string }>(
      `select count(*) from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'task'
          and c.resource_id = $1
          and g.kind = 'member'
          and g.member_id = $2
          and b.deleted_at is null`,
      [task.id, otherMemberId],
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("notifies everyone assigned except the actor", async () => {
    const task = await createTask("Rewrite the first-run screen", {
      assigneeIds: [ownerMemberId, otherMemberId],
    });
    expect(task.id.length).toBeGreaterThan(0);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ recipient_member_id: string }>(
      "select recipient_member_id from notifications where workspace_id = $1",
      [workspaceId],
    );
    const notified = rows.map((row) => row.recipient_member_id);
    // Bo is told. Ada assigned herself and is not told about her own doing,
    // which is the rule the whole notification layer already applies.
    expect(notified).toContain(otherMemberId);
    expect(notified).not.toContain(ownerMemberId);
  });

  it("assigns the same member twice as one assignment", async () => {
    const task = await createTask("Rewrite the first-run screen");
    const first = (await call("tasks.assign", {
      id: task.id,
      memberId: otherMemberId,
    })) as { assigned: boolean };
    const again = (await call("tasks.assign", {
      id: task.id,
      memberId: otherMemberId,
    })) as { assigned: boolean };
    expect(first.assigned).toBe(true);
    expect(again.assigned).toBe(false);

    const read = (await call("tasks.read", { id: task.id })) as {
      assignees: { id: string }[];
    };
    expect(read.assignees).toHaveLength(1);
  });

  it("refuses an agent, because an agent carries nothing", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      `select id from workspace_members
        where workspace_id = $1 and kind = 'agent' and deleted_at is null
        limit 1`,
      [workspaceId],
    );
    const task = await createTask("Rewrite the first-run screen");
    await expect(
      call("tasks.assign", { id: task.id, memberId: rows[0]?.id }),
    ).rejects.toThrow(/does not carry it/);
  });
});

describe("the checklist and the card", () => {
  it("counts its checklist on the card, ticked over total", async () => {
    const task = await createTask("Rewrite the first-run screen");
    const one = (await call("tasks.addChecklistItem", {
      id: task.id,
      title: "Draft the copy",
    })) as { id: string };
    await call("tasks.addChecklistItem", {
      id: task.id,
      title: "Review the copy",
    });
    await call("tasks.setChecklistItem", {
      id: task.id,
      itemId: one.id,
      done: true,
    });

    const read = (await call("tasks.read", { id: task.id })) as {
      checklist: { done: number; total: number };
      items: { id: string; done: boolean }[];
    };
    expect(read.checklist).toEqual({ done: 1, total: 2 });
    expect(read.items).toHaveLength(2);
  });

  it("stops counting a line that was removed", async () => {
    const task = await createTask("Rewrite the first-run screen");
    const one = (await call("tasks.addChecklistItem", {
      id: task.id,
      title: "Draft the copy",
    })) as { id: string };
    await call("tasks.removeChecklistItem", { id: task.id, itemId: one.id });

    const read = (await call("tasks.read", { id: task.id })) as {
      checklist: { done: number; total: number };
    };
    expect(read.checklist).toEqual({ done: 0, total: 0 });
  });
});

describe("the board, which is a view over one set of rows", () => {
  it("answers the same card from a space, an initiative and a key result", async () => {
    const initiative = (await call("initiatives.create", {
      spaceId,
      title: "Rebuild the activation flow",
      ownerId: ownerMemberId,
    })) as { id: string };
    const task = await createTask("Rewrite the first-run screen", {
      initiativeId: initiative.id,
      keyResultId,
    });

    for (const filter of [
      { spaceId },
      { initiativeId: initiative.id },
      { keyResultId },
    ]) {
      const board = (await call("tasks.board", filter)) as {
        columns: { cards: { id: string }[] }[];
      };
      const ids = board.columns.flatMap((one) =>
        one.cards.map((card) => card.id),
      );
      expect(ids, JSON.stringify(filter)).toEqual([task.id]);
    }
  });

  it("carries the rail, with the measured progress and the linked work apart", async () => {
    const task = await createTask("Rewrite the first-run screen", {
      keyResultId,
    });
    await call("tasks.update", { id: task.id, status: "done" });

    const board = (await call("tasks.board", { spaceId })) as {
      rail: {
        keyResultId: string;
        progressPct: number;
        linkedWork: { done: number; total: number };
        divergence: string | null;
      }[];
    };
    expect(board.rail).toHaveLength(1);
    expect(board.rail[0]?.keyResultId).toBe(keyResultId);
    expect(board.rail[0]?.progressPct).toBe(0);
    expect(board.rail[0]?.linkedWork).toEqual({ done: 1, total: 1 });
    expect(board.rail[0]?.divergence).toContain("1 of 1 linked task complete");
  });

  it("refuses a board of nothing at all", async () => {
    await createTask("Somewhere in this space");
    // `callAction` does not parse a read action's input, so the refine on the
    // schema was decoration and a board with no filter answered with every card
    // in the workspace. The handler parses now, and this is the test that found
    // it.
    await expect(call("tasks.board", {})).rejects.toThrow();
  });
});
