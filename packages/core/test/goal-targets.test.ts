import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Target changes with their reason, and a key result removed and restored
 * (P9-T06b, METHOD v2 §2.9).
 *
 * Making a target harder never needs a reason. Easing one, toward its
 * baseline, needs a written reason where the workspace asks for one, which by
 * default it does, through `goals.changeTarget` and `goals.updateKeyResult`
 * alike. The original stays on record. A key result removed on its own is
 * listed in deleted items, with who removed it, and comes back.
 */

const OWNER = "target-owner";
const EDITOR = "target-editor";

let workspaceId: string;
let ownerMemberId: string;
let quarterId: string;

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
async function addEditor(): Promise<void> {
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
}

async function objective(title: string, cycleId: string): Promise<string> {
  const goal = await call<{ id: string }>(OWNER, "goals.create", {
    title,
    cycleId,
    level: "team",
    ownerKind: "workspace",
    championId: ownerMemberId,
  });
  return goal.id;
}

/** An increase key result from 0 to 100. */
async function keyResult(goalId: string, title: string): Promise<string> {
  const created = await call<{ id: string }>(OWNER, "goals.addKeyResult", {
    goalId,
    title,
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 0,
    targetValue: 100,
  });
  return created.id;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Priya Owner", "target-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Priya Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  await addEditor();

  // Two years out, so the quarter is made here.
  const year = new Date().getUTCFullYear() + 2;
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

async function targetOf(keyResultId: string): Promise<number> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ target_value: string }>(
    "select target_value from key_results where id = $1",
    [keyResultId],
  );
  return Number(rows[0]?.target_value);
}

interface History {
  changes: {
    from: number;
    to: number;
    eased: boolean;
    reason: string | null;
    changedBy: string | null;
  }[];
}

async function reducing(goalId: string): Promise<string> {
  const created = await call<{ id: string }>(OWNER, "goals.addKeyResult", {
    goalId,
    title: "Support backlog from 100 to 50",
    direction: "reduce",
    indicatorType: "lagging",
    baselineValue: 100,
    targetValue: 50,
  });
  return created.id;
}

describe("goals.changeTarget", () => {
  it("makes a target harder with no reason, and records it", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    const changed = await call<{ change: { eased: boolean } }>(
      OWNER,
      "goals.changeTarget",
      { id: kr, targetValue: 120 },
    );
    expect(changed.change.eased).toBe(false);
    expect(await targetOf(kr)).toBe(120);
    const history = await call<History>(OWNER, "goals.targetHistory", {
      id: kr,
    });
    expect(history.changes).toEqual([
      expect.objectContaining({
        from: 100,
        to: 120,
        eased: false,
        reason: null,
      }),
    ]);
  });

  it("refuses easing without a reason, with the sentence, and changes nothing", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await expect(
      call(OWNER, "goals.changeTarget", { id: kr, targetValue: 80 }),
    ).rejects.toThrow(/Easing a target needs a written reason/);
    expect(await targetOf(kr)).toBe(100);
    const history = await call<History>(OWNER, "goals.targetHistory", {
      id: kr,
    });
    expect(history.changes).toEqual([]);
  });

  it("eases with a reason, and the history keeps both values and who changed it", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await call(EDITOR, "goals.changeTarget", {
      id: kr,
      targetValue: 80,
      reason: "The partner channel we counted on closed in week three",
    });
    expect(await targetOf(kr)).toBe(80);
    const history = await call<History>(OWNER, "goals.targetHistory", {
      id: kr,
    });
    expect(history.changes).toEqual([
      {
        from: 100,
        to: 80,
        eased: true,
        reason: "The partner channel we counted on closed in week three",
        midCycle: false,
        changedAt: expect.any(String),
        changedBy: "Mei Editor",
      },
    ]);
  });

  it("judges a reduce key result the other way round", async () => {
    const goal = await objective("Answer support faster", quarterId);
    const kr = await reducing(goal);
    // Raising a reduce target toward its baseline of 100 eases it.
    await expect(
      call(OWNER, "goals.changeTarget", { id: kr, targetValue: 70 }),
    ).rejects.toThrow(/Easing a target/);
    // Lowering it is harder, and needs nothing.
    await expect(
      call(OWNER, "goals.changeTarget", { id: kr, targetValue: 40 }),
    ).resolves.toBeTruthy();
  });

  it("judges a target eased in the same call that moves the baseline against the baseline it had", async () => {
    // Baseline 0, target 100: moving the baseline to 160 and the target to 60
    // in one call must still read as easing an increase, with a reason.
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await expect(
      call(OWNER, "goals.updateKeyResult", {
        id: kr,
        baselineValue: 160,
        targetValue: 60,
      }),
    ).rejects.toThrow(/Easing a target/);
    // A lowered increase target eases it whatever the baseline says.
    await call(OWNER, "goals.updateKeyResult", { id: kr, baselineValue: 160 });
    await expect(
      call(OWNER, "goals.changeTarget", { id: kr, targetValue: 60 }),
    ).rejects.toThrow(/Easing a target/);
  });

  it("lets easing through without a reason where the workspace made it optional", async () => {
    await call(OWNER, "practice.update", {
      overrides: { "reasons.easingTarget": "optional" },
    });
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await call(OWNER, "goals.changeTarget", { id: kr, targetValue: 80 });
    const history = await call<History>(OWNER, "goals.targetHistory", {
      id: kr,
    });
    expect(history.changes[0]).toMatchObject({ eased: true, reason: null });
  });

  it("records nothing for a target set to what it already is", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await call(OWNER, "goals.changeTarget", { id: kr, targetValue: 100 });
    const history = await call<History>(OWNER, "goals.targetHistory", {
      id: kr,
    });
    expect(history.changes).toEqual([]);
  });
});

describe("goals.updateKeyResult meets the same rule", () => {
  it("refuses an eased target without its reason, and records one with it", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await expect(
      call(OWNER, "goals.updateKeyResult", { id: kr, targetValue: 60 }),
    ).rejects.toThrow(/Easing a target/);
    await call(OWNER, "goals.updateKeyResult", {
      id: kr,
      targetValue: 60,
      targetReason: "Half the sales team moved to the new region",
    });
    expect(await targetOf(kr)).toBe(60);
    const history = await call<History>(OWNER, "goals.targetHistory", {
      id: kr,
    });
    expect(history.changes).toHaveLength(1);
  });
});

describe("a key result removed and restored", () => {
  interface Deleted {
    items: {
      subjectType: string;
      id: string;
      title: string;
      deletedBy: string | null;
    }[];
  }

  it("is listed in deleted items with who removed it, and comes back", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await call(OWNER, "goals.removeKeyResult", { id: kr });

    const deleted = await call<Deleted>(OWNER, "workspace.deletedItems", {});
    expect(deleted.items).toContainEqual(
      expect.objectContaining({
        subjectType: "key_result",
        id: kr,
        deletedBy: "Priya Owner",
      }),
    );

    await call(OWNER, "goals.restoreKeyResult", { id: kr });
    const tree = await call<{ goals: { keyResults: { id: string }[] }[] }>(
      OWNER,
      "goals.tree",
      { cycleId: quarterId },
    );
    expect(tree.goals[0]?.keyResults.map((row) => row.id)).toEqual([kr]);
    const after = await call<Deleted>(OWNER, "workspace.deletedItems", {});
    expect(after.items.map((item) => item.id)).not.toContain(kr);
  });

  it("is not listed on its own when its objective was deleted with it", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await call(OWNER, "goals.delete", { id: goal });

    const deleted = await call<Deleted>(OWNER, "workspace.deletedItems", {});
    expect(deleted.items.map((item) => item.id)).not.toContain(kr);
    await expect(
      call(OWNER, "goals.restoreKeyResult", { id: kr }),
    ).rejects.toThrow(/Restore the objective/);
  });

  it("is restored only by somebody who could have removed it", async () => {
    const goal = await objective("Grow the trial base", quarterId);
    const kr = await keyResult(goal, "Trials from 0 to 100");
    await call(OWNER, "goals.removeKeyResult", { id: kr });
    await expect(
      call(EDITOR, "goals.restoreKeyResult", { id: kr }),
    ).rejects.toBeTruthy();
  });
});
