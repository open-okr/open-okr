import {
  activeOnly,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
  workspaceRoles,
} from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Workspace roles and the matrix (P8-G13a,
 * docs/design/p8-g13-workspace-roles.md).
 *
 * The four things that matter and are easy to get wrong in different places:
 * a workspace is born with its roles and its founder holds Owner; a role
 * raises a member's level on a goal they hold no binding on; a binding still
 * outranks a role that grants less, because `can()` takes the maximum; and
 * the Owner role refuses to be changed or removed from any surface, not only
 * from the screen.
 */

const OWNER = "role-owner";
const OTHER = "role-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

async function withTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Role Owner",
      "role-owner@example.com",
      OTHER,
      "Role Other",
      "role-other@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Role Owner",
  });
  workspaceId = provisioned.workspaceId;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;

  // A second human, written the way the product writes one, with no role: the
  // state every member was in before this work and the state the matrix has
  // to be able to change.
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Role Other', 'active', 'human') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = second.rows[0]?.id as string;
});

describe("the roles a workspace is born with", () => {
  it("seeds four roles and gives the founder Owner", async () => {
    const wb = await workerDb();
    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    expect(roles.map((role) => role.builtinKey).sort()).toEqual([
      "admin",
      "member",
      "owner",
      "viewer",
    ]);

    const owner = roles.find((role) => role.builtinKey === "owner");
    expect(owner?.editable).toBe(false);
    expect(owner?.memberCount).toBe(1);
    expect(
      owner?.permissions.find((entry) => entry.domain === "goal")?.level,
    ).toBe(ACCESS_LEVELS.full);

    // Exactly one default, and it is Member.
    const defaults = roles.filter((role) => role.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.builtinKey).toBe("member");
  });
});

describe("what a role does to a level", () => {
  it("raises a member's level on a goal they hold no binding on", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Make onboarding something customers finish by themselves",
        level: "team",
        ownerKind: "workspace",
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
        cycleId: (
          await callAction(
            { pool: wb.appPool, ...context() },
            "cycles.current",
            {
              mode: "quarterly",
            },
          )
        )?.id as string,
        weight: 1,
      },
    );

    const levelFor = async (memberId: string) =>
      withTx(async (tx) => {
        const resolved = await resolveSubjectContext(
          tx,
          "goal",
          created.id,
          workspaceId,
        );
        return resolveMemberAccessLevel(tx, {
          workspaceId,
          memberId,
          contextId: resolved?.contextId as string,
        });
      });

    // With no role, the second member sees the goal through the workspace-wide
    // view binding and nothing more.
    expect(await levelFor(otherMemberId)).toBe(ACCESS_LEVELS.view);

    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    const member = roles.find((role) => role.builtinKey === "member");
    await callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
      memberId: otherMemberId,
      roleId: member?.id as string,
    });

    expect(await levelFor(otherMemberId)).toBe(ACCESS_LEVELS.edit);
  });

  it("leaves a binding outranking a role that grants less", async () => {
    const wb = await workerDb();
    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    const viewer = roles.find((role) => role.builtinKey === "viewer");
    await callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
      memberId: otherMemberId,
      roleId: viewer?.id as string,
    });

    const cycle = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.current",
      { mode: "quarterly" },
    );
    // The second member champions this one, which is a `full` binding.
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Make renewal a decision customers do not have to think about",
        level: "team",
        ownerKind: "workspace",
        championId: otherMemberId,
        reviewerId: ownerMemberId,
        cycleId: cycle?.id as string,
        weight: 1,
      },
    );

    const level = await withTx(async (tx) => {
      const resolved = await resolveSubjectContext(
        tx,
        "goal",
        created.id,
        workspaceId,
      );
      return resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: otherMemberId,
        contextId: resolved?.contextId as string,
      });
    });
    // Viewer grants 10 on a goal. The champion binding grants 100, and the
    // maximum is what `can()` answers with.
    expect(level).toBe(ACCESS_LEVELS.full);
  });

  it("gives an agent no role, whatever is asked", async () => {
    const wb = await workerDb();
    const agent = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, status, kind)
       values (gen_random_uuid(), $1, 'An agent', 'active', 'agent') returning id`,
      [workspaceId],
    );
    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
        memberId: agent.rows[0]?.id as string,
        roleId: roles[0]?.id as string,
      }),
    ).rejects.toThrow(/Only a person holds a role/i);
  });
});

describe("what the Owner role refuses", () => {
  it("refuses a name another role already holds, as a sentence", async () => {
    const wb = await workerDb();
    // Found by the end-to-end suite rather than by review: the unique index
    // refused the second insert and the raw database error reached the
    // screen, which fell to its error boundary. An administrator who types a
    // name that exists should be told which name to change, not lose the
    // page.
    await callAction({ pool: wb.appPool, ...context() }, "roles.create", {
      name: "Auditor",
    });
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "roles.create", {
        name: "auditor",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("refuses to have its permissions changed", async () => {
    const wb = await workerDb();
    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    const owner = roles.find((role) => role.builtinKey === "owner");
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "roles.setPermission", {
        roleId: owner?.id as string,
        domain: "goal",
        level: 10,
      }),
    ).rejects.toThrow(/Owner role cannot be changed/i);
  });

  it("refuses to be deleted, and so does a role somebody holds", async () => {
    const wb = await workerDb();
    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    const owner = roles.find((role) => role.builtinKey === "owner");
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "roles.delete", {
        id: owner?.id as string,
      }),
    ).rejects.toThrow(/Owner role cannot be changed/i);

    const member = roles.find((role) => role.builtinKey === "member");
    await callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
      memberId: otherMemberId,
      roleId: member?.id as string,
    });
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "roles.delete", {
        id: member?.id as string,
      }),
    ).rejects.toThrow(/Somebody still holds this role/i);
  });
});

describe("a role an administrator adds", () => {
  it("is created with every domain written out, and can be removed", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.create",
      {
        name: "Auditor",
        permissions: [{ domain: "goal", level: 40 }],
      },
    );

    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    const auditor = roles.find((role) => role.id === created.id);
    expect(auditor?.builtinKey).toBeNull();
    expect(auditor?.editable).toBe(true);
    expect(auditor?.permissions).toHaveLength(7);
    expect(
      auditor?.permissions.find((entry) => entry.domain === "goal")?.level,
    ).toBe(40);
    // A domain nobody set grants nothing, written out rather than absent.
    expect(
      auditor?.permissions.find((entry) => entry.domain === "kpi")?.level,
    ).toBe(0);

    await callAction({ pool: wb.appPool, ...context() }, "roles.delete", {
      id: created.id,
    });
    const after = await withTx((tx) =>
      tx
        .select({ id: workspaceRoles.id })
        .from(workspaceRoles)
        .where(activeOnly(workspaceRoles, eq(workspaceRoles.id, created.id))),
    );
    expect(after).toHaveLength(0);
  });
});

describe("the member row", () => {
  it("carries the role the founder was given", async () => {
    const rows = await withTx((tx) =>
      tx
        .select({ roleId: workspaceMembers.roleId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.id, ownerMemberId)),
    );
    expect(rows[0]?.roleId).not.toBeNull();
  });
});

describe("a goal in a space, after P8-G13c", () => {
  /**
   * The binding that used to answer "who may edit this objective" is gone, so
   * the role is the only thing that answers it. These two tests are the pair
   * that would have caught putting it back: one says the space grants nothing
   * beyond the workspace-wide view, the other says the role still does.
   */
  const goalInASpace = async () => {
    const wb = await workerDb();
    const space = await callAction(
      { pool: wb.appPool, ...context() },
      "spaces.create",
      { name: "Revenue" },
    );
    await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
      spaceId: space.id,
      memberId: otherMemberId,
      role: "member",
    });
    const cycle = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.current",
      { mode: "quarterly" },
    );
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Make renewal a decision customers do not have to think about",
        level: "team",
        ownerKind: "space",
        spaceId: space.id,
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
        cycleId: cycle?.id as string,
        weight: 1,
      },
    );
    return created.id;
  };

  const levelOn = async (goalId: string, memberId: string) =>
    withTx(async (tx) => {
      const resolved = await resolveSubjectContext(
        tx,
        "goal",
        goalId,
        workspaceId,
      );
      return resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId,
        contextId: resolved?.contextId as string,
      });
    });

  it("grants a member of that space nothing beyond the workspace-wide view", async () => {
    const goalId = await goalInASpace();
    // No role, so the only thing reaching them is `workspace_standard` at
    // view. Before P8-G13c the space binding made this `edit`.
    expect(await levelOn(goalId, otherMemberId)).toBe(ACCESS_LEVELS.view);
  });

  it("still grants the edit through the role, which is the point", async () => {
    const wb = await workerDb();
    const goalId = await goalInASpace();
    const { roles } = await callAction(
      { pool: wb.appPool, ...context() },
      "roles.list",
      {},
    );
    const member = roles.find((role) => role.builtinKey === "member");
    await callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
      memberId: otherMemberId,
      roleId: member?.id as string,
    });
    expect(await levelOn(goalId, otherMemberId)).toBe(ACCESS_LEVELS.edit);

    // And lowering that role is what takes it away, which is what the screen
    // promises and what could not be true while the space binding stood.
    await callAction(
      { pool: wb.appPool, ...context() },
      "roles.setPermission",
      { roleId: member?.id as string, domain: "goal", level: 10 },
    );
    expect(await levelOn(goalId, otherMemberId)).toBe(ACCESS_LEVELS.view);
  });
});

describe("the number of answers a form demands (P8-G13d)", () => {
  it("creates a cycle from a date alone, with every field resolved", async () => {
    const wb = await workerDb();
    const half = new Date();
    half.setUTCMonth(half.getUTCMonth() + 6);
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.create",
      { on: half.toISOString().slice(0, 10), firstCycle: false } as never,
    );

    const row = created as {
      id: string;
      sponsorId: string | null;
      facilitatorId: string | null;
      publicationDeadline: string | null;
      startsOn: string;
    };
    // Named rather than left for somebody to answer: METHOD.md §2 phase 1
    // asks that both be named, and whoever made the cycle is both until they
    // say otherwise.
    expect(row.sponsorId).toBe(ownerMemberId);
    expect(row.facilitatorId).toBe(ownerMemberId);
    // Publish gate 6 asks for a date strictly before day one and says nothing
    // about how far before, so the latest allowed date is the only one the
    // product can choose without inventing a judgement.
    expect(row.publicationDeadline).not.toBeNull();
    expect((row.publicationDeadline as string) < row.startsOn).toBe(true);
  });

  it("creates an objective from a title alone, championed by whoever typed it", async () => {
    const wb = await workerDb();
    const cycle = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.current",
      { mode: "quarterly" },
    );
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Make onboarding something customers finish by themselves",
        level: "team",
        ownerKind: "workspace",
        cycleId: cycle?.id as string,
        weight: 1,
      } as never,
    );

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: created.id },
    );
    expect(read.champion.id).toBe(ownerMemberId);
    // The reviewer follows the practice since Phase 9 merged with P8-G13d:
    // optional by default (P9-T04), so a title alone names nobody to
    // acknowledge, and the creator only where reviewers are required.
    expect(read.reviewer).toBeNull();
    // And the quality canon says what is still missing rather than the create
    // refusing: a reviewer who is also the champion is a finding, not a wall.
    expect(read.quality).toBeTruthy();
  });
});
