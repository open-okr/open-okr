import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Who may set up a cycle (docs/design/workspace-roles.md §12, plan 0.8.0 R1).
 *
 * Setting up a cycle asked for `full` on the workspace, which only the Owner
 * holds, so an Admin could not name a sponsor. Lowering it to `edit` alone
 * would have handed it to every Member as well, because every member holds
 * `edit` on the workspace context for self-service. The setup writes declare
 * the `workspace` domain instead, so a role holder is measured by the role.
 */

const OWNER = "setup-owner";
const ADMIN = "setup-admin";
const MEMBER = "setup-member";
const VIEWER = "setup-viewer";
const LEAD = "setup-lead";
const GUEST = "setup-guest";

let workspaceId: string;
const memberIds = new Map<string, string>();
let agentMemberId: string;

const human = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

async function as(userId: string) {
  const wb = await workerDb();
  return { pool: wb.appPool, ...human(userId) };
}

/** Whether a call was refused for the caller's level, and nothing else. */
async function refusedForLevel(call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return false;
  } catch (error) {
    return /needs a higher access level|No such|not a member/i.test(
      (error as Error).message,
    );
  }
}

/** Passed the access floor, whatever the action then decided. */
async function clearedTheFloor(call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return true;
  } catch (error) {
    return !/needs a higher access level/.test((error as Error).message);
  }
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  const people = [OWNER, ADMIN, MEMBER, VIEWER, LEAD, GUEST];
  for (const id of people) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [id, id, `${id}@example.com`],
    );
  }
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: OWNER })
  ).workspaceId;

  // Members written the way roles.test.ts writes them: a human row, then a
  // role through the action an administrator uses.
  for (const id of [ADMIN, MEMBER, VIEWER, LEAD]) {
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
       values (gen_random_uuid(), $1, $2, $2, 'active', 'human') returning id`,
      [workspaceId, id],
    );
    memberIds.set(id, row.rows[0]?.id as string);
  }
  // A guest invited to a space holds no role and nothing on the workspace.
  const guest = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, $2, 'active', 'guest') returning id`,
    [workspaceId, GUEST],
  );
  memberIds.set(GUEST, guest.rows[0]?.id as string);

  const owner = await as(OWNER);
  const { roles } = await callAction(owner, "roles.list", {});
  const builtin = (key: string) =>
    roles.find((role) => role.builtinKey === key)?.id as string;
  for (const [id, key] of [
    [ADMIN, "admin"],
    [MEMBER, "member"],
    [VIEWER, "viewer"],
  ] as const) {
    await callAction(owner, "roles.assign", {
      memberId: memberIds.get(id) as string,
      roleId: builtin(key),
    });
  }
  // A role the workspace made, granting edit on the workspace and nothing
  // more than a Member elsewhere.
  const lead = await callAction(owner, "roles.create", {
    name: "Cycle lead",
  } as never);
  const leadRoleId = (lead as { id: string }).id;
  await callAction(owner, "roles.setPermission", {
    roleId: leadRoleId,
    domain: "workspace",
    level: 70,
  });
  await callAction(owner, "roles.assign", {
    memberId: memberIds.get(LEAD) as string,
    roleId: leadRoleId,
  });

  const agent = await wb.admin.query<{ member_id: string }>(
    "select member_id from agents where workspace_id = $1 and kind = 'champion'",
    [workspaceId],
  );
  agentMemberId = agent.rows[0]?.member_id as string;
});

const nextQuarter = () => {
  const on = new Date();
  on.setUTCMonth(on.getUTCMonth() + 3);
  return on.toISOString().slice(0, 10);
};

describe("who may create a cycle", () => {
  it("the Owner, an Admin and a role granting edit on the workspace", async () => {
    for (const id of [OWNER, ADMIN, LEAD]) {
      const wb = await workerDb();
      await wb.admin.query("delete from cycles where workspace_id = $1", [
        workspaceId,
      ]);
      const created = await callAction(await as(id), "cycles.create", {
        on: nextQuarter(),
      } as never);
      expect((created as { id: string }).id).toBeTruthy();
    }
  });

  it("not a Member, a Viewer, a guest or an agent", async () => {
    for (const id of [MEMBER, VIEWER, GUEST]) {
      expect(
        await refusedForLevel(
          callAction(await as(id), "cycles.create", {
            on: nextQuarter(),
          } as never),
        ),
      ).toBe(true);
    }
    const wb = await workerDb();
    expect(
      await refusedForLevel(
        callAction(
          {
            pool: wb.appPool,
            workspaceId,
            actor: { kind: "agent" as const, memberId: agentMemberId },
          },
          "cycles.create",
          { on: nextQuarter() } as never,
        ),
      ),
    ).toBe(true);
  });
});

describe("naming a sponsor", () => {
  it("an Admin names a Member the sponsor, and a Member cannot", async () => {
    const created = (await callAction(await as(OWNER), "cycles.create", {
      on: nextQuarter(),
    } as never)) as { id: string };
    const updated = (await callAction(await as(ADMIN), "cycles.update", {
      id: created.id,
      sponsorId: memberIds.get(MEMBER) as string,
    })) as { sponsorId: string | null };
    expect(updated.sponsorId).toBe(memberIds.get(MEMBER));

    expect(
      await refusedForLevel(
        callAction(await as(MEMBER), "cycles.update", {
          id: created.id,
          sponsorId: memberIds.get(MEMBER) as string,
        }),
      ),
    ).toBe(true);
  });
});

describe("the rest of running a cycle moves with it (R1-Q1, R1-Q2)", () => {
  it("frame, publish, start closing and close clear the floor for an Admin and not for a Member", async () => {
    const cycle = (await callAction(await as(OWNER), "cycles.create", {
      on: nextQuarter(),
    } as never)) as { id: string };
    const calls = (userId: string) => [
      async () =>
        callAction(await as(userId), "frame.set", {
          yearLabel: "2027",
          strategies: [],
        } as never),
      async () =>
        callAction(await as(userId), "workflow.publish", {
          cycleId: cycle.id,
        }),
      async () =>
        callAction(await as(userId), "cycles.setClosing", {
          cycleId: cycle.id,
          closing: true,
        }),
      async () =>
        callAction(await as(userId), "cycles.close", { cycleId: cycle.id }),
    ];
    for (const call of calls(ADMIN)) {
      expect(await clearedTheFloor(call())).toBe(true);
    }
    for (const call of calls(MEMBER)) {
      expect(await refusedForLevel(call())).toBe(true);
    }
  });

  it("archiving stays with the Owner (R1-Q3)", async () => {
    const cycle = (await callAction(await as(OWNER), "cycles.create", {
      on: nextQuarter(),
    } as never)) as { id: string };
    expect(
      await refusedForLevel(
        callAction(await as(ADMIN), "cycles.archive", { id: cycle.id }),
      ),
    ).toBe(true);
  });
});

describe("cycles.setupAccess", () => {
  it("agrees with the write for every actor", async () => {
    const expected: Record<string, boolean> = {
      [OWNER]: true,
      [ADMIN]: true,
      [LEAD]: true,
      [MEMBER]: false,
      [VIEWER]: false,
    };
    for (const [id, canSetUp] of Object.entries(expected)) {
      const answer = await callAction(await as(id), "cycles.setupAccess", {});
      expect(answer, id).toEqual({ canSetUp });
    }
    const wb = await workerDb();
    const agent = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "agent" as const, memberId: agentMemberId },
      },
      "cycles.setupAccess",
      {},
    ).catch(() => ({ canSetUp: false }));
    expect(agent).toEqual({ canSetUp: false });
  });
});
