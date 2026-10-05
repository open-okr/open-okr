import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { richTextFromPlainText } from "../src/rich-text/from-text.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Moving an objective to another space (METHOD.md §2.9, P9-T13a, NW-Q3-07).
 *
 * Support merges into Customer Success, and SU1 goes with it: its key
 * results, check-ins, dependency and alignment read from the new space, and
 * the activity names both. A member who may not add to the space it is
 * going to cannot move it there.
 */

const OWNER = "move-owner";
const KOFI = "move-kofi";

let workspaceId: string;
let ownerMemberId: string;
let kofiMemberId: string;
let cycleId: string;
let support: string;
let success: string;
let engineering: string;

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

/** SU1, with one key result, three check-ins and a dependency on Engineering. */
async function su1() {
  const company = (
    await call<{ id: string }>("goals.create", {
      title: "Customers renew because the product keeps its promises",
      cycleId,
      level: "company",
    })
  ).id;
  const goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Every customer question answered the same day",
      cycleId,
      spaceId: support,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      parentGoalId: company,
    })
  ).id;
  const keyResultId = (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Same-day answers from 70% to 95%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 70,
      targetValue: 95,
    })
  ).id;
  for (const confidence of [0.6, 0.65, 0.7]) {
    await call("goals.publishDraftedCheckIn", {
      goalId,
      status: "on_track",
      confidence,
      narrative: richTextFromPlainText("Steady week."),
    });
  }
  await call("goals.addKeyResultDependency", {
    keyResultId,
    providerSpaceId: engineering,
    note: "The help centre search fix",
  });
  return { goalId, keyResultId, company };
}

async function registerIn(spaceId: string) {
  return (
    await call<{ register: { goalId: string; providerSpaceId: string }[] }>(
      "alignment.read",
      { cycleId, spaceId },
    )
  ).register;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Elena Owner",
      `${OWNER}@example.com`,
      KOFI,
      "Kofi Support",
      `${KOFI}@example.com`,
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Elena Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  support = (await call<{ id: string }>("spaces.create", { name: "Support" }))
    .id;
  success = (
    await call<{ id: string }>("spaces.create", { name: "Customer Success" })
  ).id;
  engineering = (
    await call<{ id: string }>("spaces.create", { name: "Engineering" })
  ).id;

  // Kofi is a member with the default role, in Support and nowhere else.
  const kofi = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Kofi Support', 'active',
             (select id from workspace_roles
               where workspace_id = $1 and is_default and deleted_at is null))
     returning id`,
    [workspaceId, KOFI],
  );
  kofiMemberId = kofi.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId: support,
    memberId: kofiMemberId,
    role: "member",
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a move between spaces (NW-Q3-07)", () => {
  it("acceptance: SU1's check-ins and dependency read from Customer Success, and the activity names the move", async () => {
    const { goalId, company } = await su1();
    expect((await registerIn(support)).map((row) => row.goalId)).toContain(
      goalId,
    );

    await call("goals.moveToSpace", { id: goalId, spaceId: success });

    const listed = await call<{ goals: { id: string }[] }>("goals.list", {
      spaceId: success,
    });
    expect(listed.goals.map((goal) => goal.id)).toContain(goalId);
    const checkIns = await call<{ checkIns: unknown[] }>("goals.checkIns", {
      goalId,
    });
    expect(checkIns.checkIns).toHaveLength(3);
    expect(await registerIn(success)).toEqual([
      expect.objectContaining({ goalId, providerSpaceId: engineering }),
    ]);
    expect((await registerIn(support)).map((row) => row.goalId)).not.toContain(
      goalId,
    );
    // Its alignment goes with it.
    const read = await call<{ parentGoalId: string | null; spaceId: string }>(
      "goals.read",
      { id: goalId },
    );
    expect(read).toMatchObject({ parentGoalId: company, spaceId: success });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ payload: unknown }>(
      "select payload from activities where subject_id = $1 and kind = 'goal.moved_space'",
      [goalId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({
      fromSpace: "Support",
      toSpace: "Customer Success",
    });
  });

  it("is refused to a member with edit on Support but not on Customer Success", async () => {
    const { goalId } = await su1();
    await expect(
      callAs(KOFI, "goals.moveToSpace", { id: goalId, spaceId: success }),
    ).rejects.toThrow();
    const read = await call<{ spaceId: string }>("goals.read", { id: goalId });
    expect(read.spaceId).toBe(support);
  });

  it("is allowed to the same member once they belong to both", async () => {
    const { goalId } = await su1();
    await call("spaces.addMember", {
      spaceId: success,
      memberId: kofiMemberId,
      role: "member",
    });
    await callAs(KOFI, "goals.moveToSpace", { id: goalId, spaceId: success });
    const read = await call<{ spaceId: string }>("goals.read", { id: goalId });
    expect(read.spaceId).toBe(success);
  });

  it("moves only an objective a space owns", async () => {
    const company = (
      await call<{ id: string }>("goals.create", {
        title: "Customers renew because the product keeps its promises",
        cycleId,
        level: "company",
      })
    ).id;
    await expect(
      call("goals.moveToSpace", { id: company, spaceId: success }),
    ).rejects.toThrow(/Only an objective a space owns/);
  });
});
