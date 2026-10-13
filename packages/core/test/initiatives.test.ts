import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Initiatives, and the half of METHOD.md §5.5 they carry (P5-T10a).
 *
 * Acceptance criterion:
 *   Given an initiative linked to two key results and marked as exceeding
 *   capacity, when the cycle's gates are evaluated, then gate five is red and
 *   links to that initiative.
 *
 * **The first describe block is about what this layer must not do.** The
 * work-layer design's §1 is the reason the product exists rather than a
 * technical preference: linked work is a second signal and never the first. So
 * the tests that matter most here are the ones asserting that an initiative
 * marked `done` moves nothing.
 */

const OWNER = "initiative-owner";
const OTHER = "initiative-other";

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

const addKeyResult = async (title: string) => {
  const created = (await call("goals.addKeyResult", {
    goalId,
    title,
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 0,
    targetValue: 100,
    weight: 1,
  })) as { id: string };
  return created.id;
};

const createInitiative = async (
  input: Record<string, unknown> = {},
  userId = OWNER,
) =>
  (await call(
    "initiatives.create",
    {
      spaceId,
      title: "Rebuild the activation flow",
      ownerId: ownerMemberId,
      ...input,
    },
    userId,
  )) as { id: string; title: string };

/** Gate five as the cycle screen reads it. */
const gateFive = async () => {
  const workflow = (await call("workflow.read", { cycleId })) as {
    gates: {
      gateKey: number;
      passed: boolean;
      evaluable: boolean;
      missing: string[];
    }[];
  };
  const five = workflow.gates.find((gate) => gate.gateKey === 5);
  if (!five) {
    throw new Error("gate five was not evaluated");
  }
  return five;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [
      OWNER,
      "initiative-owner@example.com",
      OTHER,
      "initiative-other@example.com",
    ],
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

describe("what an initiative must not do", () => {
  it("takes no progress from the caller, because progress is its tasks", async () => {
    const created = await createInitiative();
    // Not a rejection with a message: the field is not in the schema at all, so
    // there is no shape of request that types a percentage.
    await expect(
      call("initiatives.update", { id: created.id, progressPct: 100 }),
    ).rejects.toThrow();
  });

  it("leaves the key result's measured progress alone when it is finished", async () => {
    const created = await createInitiative();
    await call("initiatives.linkKeyResult", {
      id: created.id,
      keyResultId: firstKeyResult,
    });
    await call("initiatives.update", { id: created.id, status: "done" });

    const goal = (await call("goals.read", { id: goalId })) as {
      keyResults: { id: string; progressPct: number; currentValue: number }[];
    };
    const measured = goal.keyResults.find((one) => one.id === firstKeyResult);
    // The whole reason the product exists: a finished project is not a moved
    // number, and the divergence between them is what the Coach reports.
    expect(measured?.progressPct).toBe(0);
    expect(measured?.currentValue).toBe(0);
  });
});

describe("publish gate five, which is the acceptance criterion", () => {
  // Gate 5 holds back only work a commitment depends on (METHOD.md §5.5,
  // P9-T11b-b), so the objective these initiatives serve is committed here
  // unless a test says otherwise.
  const OVER =
    '"Rebuild the activation flow" serves a committed OKR and still exceeds capacity';
  beforeEach(async () => {
    await call("goals.setKind", { id: goalId, kind: "committed" });
  });

  // METHOD.md §5.5 (P9-T11a, P9-T11b-b): work a commitment depends on holds
  // gate 5 back at "exceeds", and work serving an aspirational OKR may exceed.
  it("is red and names the initiative that exceeds capacity behind a committed OKR", async () => {
    const created = await createInitiative({
      keyResultIds: [firstKeyResult, secondKeyResult],
      capacity: "exceeds",
    });

    const five = await gateFive();
    expect(five.evaluable).toBe(true);
    expect(five.passed).toBe(false);
    expect(five.missing).toContain(OVER);
    expect(created.title).toBe("Rebuild the activation flow");

    // The capacity read the cycle screen draws says the same.
    const capacity = (await call("initiatives.capacity", { cycleId })) as {
      exceeds: boolean;
      initiatives: { title: string; committed: boolean }[];
    };
    expect(capacity.exceeds).toBe(true);
    expect(capacity.initiatives).toEqual([
      expect.objectContaining({
        title: "Rebuild the activation flow",
        committed: true,
      }),
    ]);
  });

  it("lets an initiative serving an aspirational OKR exceed capacity", async () => {
    await call("goals.setKind", { id: goalId, kind: "aspirational" });
    const created = await createInitiative({
      keyResultIds: [firstKeyResult, secondKeyResult],
      capacity: "exceeds",
    });

    const five = await gateFive();
    expect(five.evaluable).toBe(true);
    expect(five.missing.join(" ")).not.toMatch(/exceeds capacity/);
    expect(created.title).toBe("Rebuild the activation flow");
    const capacity = (await call("initiatives.capacity", { cycleId })) as {
      exceeds: boolean;
    };
    expect(capacity.exceeds).toBe(false);
  });

  it("goes quiet about the initiative once the verdict is changed", async () => {
    const created = await createInitiative({
      keyResultIds: [firstKeyResult],
      capacity: "exceeds",
    });
    await call("initiatives.update", { id: created.id, capacity: "fits" });

    const five = await gateFive();
    expect(five.missing).not.toContain(OVER);
  });

  it("ignores an initiative that serves no key result in this cycle", async () => {
    await createInitiative({ capacity: "exceeds" });

    const five = await gateFive();
    // §5.5 is about the initiatives behind this cycle's measures. A project in
    // the same space that serves none of them is not this cycle's problem.
    expect(five.missing).not.toContain(OVER);
  });

  it("stops counting one that was unlinked", async () => {
    const created = await createInitiative({
      keyResultIds: [firstKeyResult],
      capacity: "exceeds",
    });
    await call("initiatives.unlinkKeyResult", {
      id: created.id,
      keyResultId: firstKeyResult,
    });

    const five = await gateFive();
    expect(five.missing).not.toContain(OVER);
  });

  it("stops counting one that was deleted", async () => {
    const created = await createInitiative({
      keyResultIds: [firstKeyResult],
      capacity: "exceeds",
    });
    await call("initiatives.delete", { id: created.id });

    const five = await gateFive();
    expect(five.missing).not.toContain(OVER);
  });
});

describe("the link, which is what §5.5 asks a facilitator to record", () => {
  it("records the same link twice as one link", async () => {
    const created = await createInitiative();
    const first = (await call("initiatives.linkKeyResult", {
      id: created.id,
      keyResultId: firstKeyResult,
    })) as { linked: boolean };
    const again = (await call("initiatives.linkKeyResult", {
      id: created.id,
      keyResultId: firstKeyResult,
    })) as { linked: boolean };

    expect(first.linked).toBe(true);
    // The same statement made twice, not an error: §5.5 is about recording what
    // moves a number.
    expect(again.linked).toBe(false);

    const read = (await call("initiatives.read", { id: created.id })) as {
      keyResultIds: string[];
    };
    expect(read.keyResultIds).toEqual([firstKeyResult]);
  });

  it("revives a link that was removed rather than duplicating it", async () => {
    const created = await createInitiative({ keyResultIds: [firstKeyResult] });
    await call("initiatives.unlinkKeyResult", {
      id: created.id,
      keyResultId: firstKeyResult,
    });
    await call("initiatives.linkKeyResult", {
      id: created.id,
      keyResultId: firstKeyResult,
    });

    const read = (await call("initiatives.read", { id: created.id })) as {
      keyResultIds: string[];
    };
    expect(read.keyResultIds).toEqual([firstKeyResult]);
  });

  it("refuses a key result that is not there, with the browser's sentence", async () => {
    const created = await createInitiative();
    await expect(
      call("initiatives.linkKeyResult", {
        id: created.id,
        keyResultId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow(/No such key result/);
  });
});

describe("the capacity view the align-and-commit session reads", () => {
  // `exceeds` is gate five's question, which only committed work answers
  // (METHOD.md §5.5, P9-T11b-b); the objective here is committed.
  beforeEach(async () => {
    await call("goals.setKind", { id: goalId, kind: "committed" });
  });

  it("answers every key result in the cycle with the initiatives behind it", async () => {
    const created = await createInitiative({
      keyResultIds: [firstKeyResult],
      capacity: "exceeds",
    });

    const view = (await call("initiatives.capacity", { cycleId })) as {
      keyResults: { id: string; initiativeIds: string[] }[];
      initiatives: { id: string; capacity: string | null }[];
      exceeds: boolean;
    };

    expect(view.keyResults.map((one) => one.id).sort()).toEqual(
      [firstKeyResult, secondKeyResult].sort(),
    );
    expect(
      view.keyResults.find((one) => one.id === firstKeyResult)?.initiativeIds,
    ).toEqual([created.id]);
    expect(
      view.keyResults.find((one) => one.id === secondKeyResult)?.initiativeIds,
    ).toEqual([]);
    expect(view.exceeds).toBe(true);
  });

  it("reports the per-key-result verdict as well as the initiative's", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update key_results set capacity = 'exceeds' where id = $1",
      [secondKeyResult],
    );

    const view = (await call("initiatives.capacity", { cycleId })) as {
      keyResults: { id: string; capacity: string | null }[];
      exceeds: boolean;
    };
    // Two different problems with two different fixes, which is why the gate
    // reads both columns rather than one.
    expect(
      view.keyResults.find((one) => one.id === secondKeyResult)?.capacity,
    ).toBe("exceeds");
    expect(view.exceeds).toBe(true);
  });
});

describe("access, which is the space's and the owner's", () => {
  it("binds the owner at full on this one initiative and nowhere else", async () => {
    const created = await createInitiative({ ownerId: otherMemberId });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ level: number; count: string }>(
      `select b.level, count(*)::text as count from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'initiative'
          and c.resource_id = $1
          and g.kind = 'member'
          and g.member_id = $2
          and b.deleted_at is null
        group by b.level`,
      [created.id, otherMemberId],
    );
    // `full`, on this context only. What it buys is the resource-level half of
    // every write: a member outside the space still reaches their own work.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe(100);
  });

  it("imports an initiative its importer owns, bound once at full", async () => {
    // Completeness review M-17. The owner's binding and the importer's are
    // one untagged binding of one group when they are the same person, and
    // the second insert used to break the unique index.
    const created = await createInitiative({
      ownerId: ownerMemberId,
      legacy: { type: "csv", id: "init-own" },
    });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ level: number }>(
      `select b.level from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'initiative'
          and c.resource_id = $1
          and g.kind = 'member'
          and g.member_id = $2
          and b.deleted_at is null`,
      [created.id, ownerMemberId],
    );
    expect(rows.map((row) => row.level)).toEqual([100]);
  });

  it("hands an imported initiative to its importer, raising their grant to full", async () => {
    // Found while fixing M-17. The import bound its actor at edit, and handing
    // them the initiative later bound the same group again at full, which the
    // unique index refused.
    const created = await createInitiative({
      ownerId: otherMemberId,
      legacy: { type: "csv", id: "init-later" },
    });
    await call(
      "initiatives.update",
      { id: created.id, ownerId: ownerMemberId },
      OTHER,
    );

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ level: number }>(
      `select b.level from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'initiative'
          and c.resource_id = $1
          and g.kind = 'member'
          and g.member_id = $2
          and b.deleted_at is null`,
      [created.id, ownerMemberId],
    );
    expect(rows.map((row) => row.level)).toEqual([100]);
  });

  it("asks a destructive action for both gates, exactly as goals.delete does", async () => {
    // Owning a thing does not make somebody able to delete things: the
    // workspace-level `full` is checked first, and an ordinary member does not
    // hold it. Loosening that for initiatives alone would be an access rule
    // changed on nobody's authority.
    const theirs = await createInitiative({ ownerId: otherMemberId });
    await expect(
      call("initiatives.delete", { id: theirs.id }, OTHER),
    ).rejects.toThrow(/higher access level/);

    // **The workspace owner can delete it, and that is new** (P8-G13a). The
    // second gate is `full` on the initiative's own context, and the Owner
    // role grants manage on the initiative domain, so the maximum meets it.
    // Before roles only the initiative's own owner held that, which is the
    // open question `goals/service.ts` recorded rather than a defect; the
    // matrix is what answers it. An ordinary member is still refused above,
    // because the Member role grants edit and the gate asks for manage.
    await expect(
      call("initiatives.delete", { id: theirs.id }),
    ).resolves.toBeTruthy();

    const mine = await createInitiative();
    await expect(
      call("initiatives.delete", { id: mine.id }),
    ).resolves.toBeTruthy();
  });

  it("answers a member of no workspace with not-found rather than forbidden", async () => {
    const created = await createInitiative();
    await expect(
      call("initiatives.read", { id: created.id }, "nobody-at-all"),
    ).rejects.toThrow(/No such initiative/);
  });

  it("refuses an owner who is not a member of this workspace", async () => {
    await expect(
      call("initiatives.create", {
        spaceId,
        title: "Owned by a stranger",
        ownerId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow(/No such member/);
  });

  it("refuses an agent as owner, because an agent carries nothing", async () => {
    const wb = await workerDb();
    // Every workspace is provisioned with the Coach and the Champion, so this
    // is not a contrived member: without the check they sat in the owner picker
    // on the real screen, which is where this was found.
    const { rows } = await wb.admin.query<{ id: string; name: string }>(
      `select id, name from workspace_members
        where workspace_id = $1 and kind = 'agent' and deleted_at is null
        limit 1`,
      [workspaceId],
    );
    const agent = rows[0];
    expect(agent).toBeDefined();

    await expect(
      call("initiatives.create", {
        spaceId,
        title: "Owned by an agent",
        ownerId: agent?.id,
      }),
    ).rejects.toThrow(/does not carry it/);
  });

  it("moves the binding when ownership moves, not just the column", async () => {
    const created = await createInitiative();
    await call("initiatives.update", {
      id: created.id,
      ownerId: otherMemberId,
    });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ count: string }>(
      `select count(*) from access_bindings b
         join access_groups g on g.id = b.group_id
         join access_contexts c on c.id = b.context_id
        where c.resource_type = 'initiative'
          and c.resource_id = $1
          and g.kind = 'member'
          and g.member_id = $2
          and b.deleted_at is null`,
      [created.id, ownerMemberId],
    );
    // The old owner keeps nothing of their own. What they still hold is
    // whatever the space gives every member, which is the point of a rebind
    // rather than a column write.
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe("the list, filtered the way S-26 asks for it", () => {
  it("answers by space, by key result, by status and by verdict", async () => {
    const linked = await createInitiative({
      title: "Linked work",
      keyResultIds: [firstKeyResult],
      capacity: "exceeds",
      status: "active",
    });
    await createInitiative({ title: "Unlinked work" });

    const bySpace = (await call("initiatives.list", { spaceId })) as {
      id: string;
    }[];
    expect(bySpace).toHaveLength(2);

    const byKeyResult = (await call("initiatives.list", {
      keyResultId: firstKeyResult,
    })) as { id: string }[];
    expect(byKeyResult.map((one) => one.id)).toEqual([linked.id]);

    const byStatus = (await call("initiatives.list", {
      status: "active",
    })) as { id: string }[];
    expect(byStatus.map((one) => one.id)).toEqual([linked.id]);

    const byCapacity = (await call("initiatives.list", {
      capacity: "exceeds",
    })) as { id: string }[];
    expect(byCapacity.map((one) => one.id)).toEqual([linked.id]);
  });

  it("carries the owner and the space by name, so a row needs no second read", async () => {
    await createInitiative();
    const [row] = (await call("initiatives.list", {})) as {
      ownerName: string;
      spaceName: string;
      progressPct: number;
    }[];
    expect(row?.ownerName).toBe("Ada");
    expect(row?.spaceName.length).toBeGreaterThan(0);
    // Zero until P5-T11 counts tasks, and honestly zero rather than absent.
    expect(row?.progressPct).toBe(0);
  });
});

/**
 * An initiative's progress is the share of its own tasks that are done
 * (S-26, P6-G28).
 *
 * **`initiatives.progress_pct` exists as a column and nothing has ever written
 * to it.** Every initiative in the product answered nought per cent from
 * P5-T11 until this row, and the page said so in a card explaining that the
 * tasks panel had not been built. The figure is derived in the read now, from
 * the same count the panel needs.
 */
describe("initiative progress (P6-G28)", () => {
  it("is zero with no tasks, and says the total is zero rather than none done", async () => {
    const initiative = await createInitiative({ title: "Nothing planned yet" });
    const read = (await call("initiatives.read", { id: initiative.id })) as {
      progressPct: number;
      tasks: { done: number; total: number };
    };
    // Not "nought per cent done": an initiative with no tasks has not been
    // broken down, and `total` is the only thing that can say so.
    expect(read.progressPct).toBe(0);
    expect(read.tasks).toEqual({ done: 0, total: 0 });
  });

  it("is the rounded share of the ones that are done", async () => {
    const initiative = await createInitiative({
      title: "Three tasks, one done",
    });
    for (const [title, status] of [
      ["Write the brief", "done"],
      ["Draft the screens", "todo"],
      ["Ship it", "in_progress"],
    ] as const) {
      await call("tasks.create", {
        spaceId,
        title,
        initiativeId: initiative.id,
        status,
      });
    }

    const read = (await call("initiatives.read", { id: initiative.id })) as {
      progressPct: number;
      tasks: { done: number; total: number };
    };
    expect(read.tasks).toEqual({ done: 1, total: 3 });
    // The test plan's own figure.
    expect(read.progressPct).toBe(33);
  });

  it("lists only that initiative's tasks", async () => {
    // `tasks.list` had no way to answer this: the board is per space, and the
    // other filters are per person or per date.
    const mine = await createInitiative({ title: "Mine" });
    const theirs = await createInitiative({ title: "Theirs" });
    await call("tasks.create", {
      spaceId,
      title: "Belongs to mine",
      initiativeId: mine.id,
    });
    await call("tasks.create", {
      spaceId,
      title: "Belongs to theirs",
      initiativeId: theirs.id,
    });

    const listed = (await call("tasks.list", {
      initiativeId: mine.id,
    })) as { title: string }[];
    expect(listed.map((task) => task.title)).toEqual(["Belongs to mine"]);
  });
});

describe("an initiative's dates (guided-inputs §4.9)", () => {
  it("are calendar dates, as a key result's is, and nothing else", async () => {
    await expect(createInitiative({ startsOn: "next month" })).rejects.toThrow(
      "Give the date as YYYY-MM-DD.",
    );
    await expect(createInitiative({ endsOn: "2030/06/30" })).rejects.toThrow(
      "Give the date as YYYY-MM-DD.",
    );
  });
});

describe("an initiative that ends before it starts (guided-inputs §4.9)", () => {
  it("is refused, as leave and a holiday are, on creation and on a change", async () => {
    await expect(
      createInitiative({ startsOn: "2030-06-01", endsOn: "2030-05-31" }),
    ).rejects.toThrow("An initiative ends on or after the day it starts.");
    const initiative = await createInitiative({
      startsOn: "2030-06-01",
      endsOn: "2030-06-30",
    });
    // Measured against the start it already has.
    await expect(
      call("initiatives.update", { id: initiative.id, endsOn: "2030-05-01" }),
    ).rejects.toThrow("An initiative ends on or after the day it starts.");
    await call("initiatives.update", {
      id: initiative.id,
      endsOn: "2030-06-01",
    });
  });

  it("is refused for an import too, so the importers leave the end out instead", async () => {
    // The table has refused it since migration 0064
    // (initiatives_window_check); an import keeps the start and reports the
    // end it left out, which the import tests check.
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human" as const, userId: OWNER },
          bulk: true,
        },
        "initiatives.create",
        {
          spaceId,
          title: "Imported with its deadline before its start",
          ownerId: ownerMemberId,
          startsOn: "2024-03-01",
          endsOn: "2024-02-01",
        },
      ),
    ).rejects.toThrow("An initiative ends on or after the day it starts.");
  });
});
