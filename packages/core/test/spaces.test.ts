import { type WorkspaceTx, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import {
  resolveCoordinator,
  resolveManagers,
  wouldStrandSpace,
} from "../src/spaces/roles.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Spaces (P3-T01, TECHNICAL-PLAN §4.2, §4.14, METHOD.md §2.5).
 *
 * The task's own acceptance criterion is the third test in "adding a member":
 * a space manager adds somebody, and that person gains space-standard access to
 * the space immediately, with no second grant anywhere.
 *
 * Everything else here guards a specific way this could be wrong: a role change
 * that adds a binding without removing the last one, a demotion that leaves a
 * space nobody can administer, a workspace admin locked out of a space they own
 * the workspace of, and a leave that takes away the discovery binding as well as
 * the membership.
 */

const OWNER = "spaces-owner";

let workspaceId: string;
let ownerMemberId: string;
let defaultSpaceId: string;

async function withReadTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

/** A real member with a real user behind them, so they can act. */
async function addMemberWithUser(
  userId: string,
  name: string,
): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, name, `${userId}@example.com`],
  );
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, $3, 'human', 'active')
     returning id`,
    [workspaceId, userId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

/** A member's effective level on a space's own context. */
async function levelOnSpace(
  memberId: string,
  spaceId: string,
): Promise<number> {
  return withReadTx(async (tx) => {
    const resolved = await resolveSubjectContext(
      tx,
      "space",
      spaceId,
      workspaceId,
    );
    if (!resolved) {
      throw new Error("the space has no access context");
    }
    return resolveMemberAccessLevel(tx, {
      workspaceId,
      memberId,
      contextId: resolved.contextId,
    });
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Spaces Owner", "spaces-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Spaces Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = await callAction(
    { pool: wb.appPool, ...context(OWNER) },
    "spaces.list",
    {},
  );
  defaultSpaceId = spaces[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the role rules, as pure functions", () => {
  it("names the coordinator when there is one", () => {
    expect(
      resolveCoordinator([
        { memberId: "m1", role: "manager" },
        { memberId: "m2", role: "coordinator" },
      ]),
    ).toBe("m2");
  });

  it("falls back to the first manager when there is none", () => {
    expect(
      resolveCoordinator([
        { memberId: "m1", role: "member" },
        { memberId: "m2", role: "manager" },
        { memberId: "m3", role: "manager" },
      ]),
    ).toBe("m2");
  });

  it("has nobody to name in a space of plain members", () => {
    expect(resolveCoordinator([{ memberId: "m1", role: "member" }])).toBe(
      undefined,
    );
  });

  it("lists every manager", () => {
    expect(
      resolveManagers([
        { memberId: "m1", role: "manager" },
        { memberId: "m2", role: "member" },
        { memberId: "m3", role: "manager" },
      ]),
    ).toEqual(["m1", "m3"]);
  });

  it("sees that removing the last manager strands a space with members", () => {
    expect(
      wouldStrandSpace(
        [
          { memberId: "m1", role: "manager" },
          { memberId: "m2", role: "member" },
        ],
        "m1",
      ),
    ).toBe(true);
  });

  it("does not call an emptied space stranded", () => {
    expect(wouldStrandSpace([{ memberId: "m1", role: "manager" }], "m1")).toBe(
      false,
    );
  });

  it("does not call it stranded while another manager remains", () => {
    expect(
      wouldStrandSpace(
        [
          { memberId: "m1", role: "manager" },
          { memberId: "m2", role: "manager" },
        ],
        "m1",
      ),
    ).toBe(false);
  });
});

describe("workspace provisioning creates the default space", () => {
  it("names it after the workspace, with the first member as its manager", async () => {
    const wb = await workerDb();
    const detail = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.read",
      { id: defaultSpaceId },
    );

    // §4.14: "One space named after the workspace." Not "General", and not a
    // setting anybody has to answer.
    expect(detail.name).toBe("Spaces Owner's workspace");
    expect(detail.members).toEqual([
      { memberId: ownerMemberId, name: "Spaces Owner", role: "manager" },
    ]);
    // No coordinator is named, so the manager covers those duties (§4.2).
    expect(detail.coordinatorMemberId).toBe(ownerMemberId);
  });

  it("gives its manager full access to it", async () => {
    expect(await levelOnSpace(ownerMemberId, defaultSpaceId)).toBe(
      ACCESS_LEVELS.full,
    );
  });

  it("makes it discoverable at view by a member who is not in it", async () => {
    const outsider = await addMemberWithUser("spaces-outsider", "Outsider");
    expect(await levelOnSpace(outsider, defaultSpaceId)).toBe(
      ACCESS_LEVELS.view,
    );
  });
});

describe("adding a member", () => {
  it("refuses a space name another space already holds", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "spaces.create", {
        name: "Spaces Owner's workspace",
      }),
    ).rejects.toThrow();
  });

  it("gives them the space's own membership row and role", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-joiner", "Joiner");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );

    const detail = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.read",
      { id: defaultSpaceId },
    );
    expect(detail.members).toHaveLength(2);
    expect(detail.members.find((row) => row.memberId === member)?.role).toBe(
      "member",
    );
  });

  /**
   * The task's acceptance criterion, in one assertion: "Given a space manager,
   * when they add a member, then that member gains space-standard access to the
   * space's aggregates immediately."
   */
  it("raises their access from view to edit at once, with no second grant", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-acceptance", "Newcomer");

    expect(await levelOnSpace(member, defaultSpaceId)).toBe(ACCESS_LEVELS.view);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );

    expect(await levelOnSpace(member, defaultSpaceId)).toBe(ACCESS_LEVELS.edit);
  });

  it("gives a manager full and a coordinator only edit", async () => {
    const wb = await workerDb();
    const manager = await addMemberWithUser("spaces-manager", "Manager");
    const coordinator = await addMemberWithUser("spaces-coord", "Coordinator");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: manager, role: "manager" },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: coordinator, role: "coordinator" },
    );

    expect(await levelOnSpace(manager, defaultSpaceId)).toBe(
      ACCESS_LEVELS.full,
    );
    // Running the weekly session is a duty, not extra access.
    expect(await levelOnSpace(coordinator, defaultSpaceId)).toBe(
      ACCESS_LEVELS.edit,
    );
  });

  it("names the coordinator ahead of the manager once one exists", async () => {
    const wb = await workerDb();
    const coordinator = await addMemberWithUser("spaces-coord2", "Coordinator");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: coordinator, role: "coordinator" },
    );

    const detail = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.read",
      { id: defaultSpaceId },
    );
    expect(detail.coordinatorMemberId).toBe(coordinator);
  });

  it("changes the role rather than adding a second membership row", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-twice", "Twice");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "manager" },
    );

    const detail = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.read",
      { id: defaultSpaceId },
    );
    expect(
      detail.members.filter((row) => row.memberId === member),
    ).toHaveLength(1);
    expect(await levelOnSpace(member, defaultSpaceId)).toBe(ACCESS_LEVELS.full);
  });
});

describe("changing a role", () => {
  it("takes back what the old role granted", async () => {
    const wb = await workerDb();
    const manager = await addMemberWithUser("spaces-demote", "Demote Me");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: manager, role: "manager" },
    );
    expect(await levelOnSpace(manager, defaultSpaceId)).toBe(
      ACCESS_LEVELS.full,
    );

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.setMemberRole",
      { spaceId: defaultSpaceId, memberId: manager, role: "member" },
    );

    // The bug this guards: adding the new role's binding without removing the
    // old one would leave a demoted manager holding full for ever.
    expect(await levelOnSpace(manager, defaultSpaceId)).toBe(
      ACCESS_LEVELS.edit,
    );
  });

  it("refuses to demote the last manager of a space with members", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-other", "Other");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "spaces.setMemberRole",
        { spaceId: defaultSpaceId, memberId: ownerMemberId, role: "member" },
      ),
    ).rejects.toThrow(/no manager/i);
  });
});

describe("removing a member", () => {
  it("takes back the space access and keeps the space visible", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-remove", "Removable");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );
    expect(await levelOnSpace(member, defaultSpaceId)).toBe(ACCESS_LEVELS.edit);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.removeMember",
      { spaceId: defaultSpaceId, memberId: member },
    );

    // Back to discovery, not to nothing: a team home stays rejoinable.
    expect(await levelOnSpace(member, defaultSpaceId)).toBe(ACCESS_LEVELS.view);
  });

  it("refuses to remove the last manager of a space with members", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-keeper", "Keeper");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "spaces.removeMember",
        { spaceId: defaultSpaceId, memberId: ownerMemberId },
      ),
    ).rejects.toThrow(/no manager/i);
  });
});

describe("joining and leaving", () => {
  it("lets an ordinary member join a space they can see", async () => {
    const wb = await workerDb();
    await addMemberWithUser("spaces-selfjoin", "Self Joiner");

    await callAction(
      { pool: wb.appPool, ...context("spaces-selfjoin") },
      "spaces.join",
      { spaceId: defaultSpaceId },
    );

    const detail = await callAction(
      { pool: wb.appPool, ...context("spaces-selfjoin") },
      "spaces.read",
      { id: defaultSpaceId },
    );
    expect(detail.ownRole).toBe("member");
  });

  it("lets them leave again", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-selfleave", "Self Leaver");

    await callAction(
      { pool: wb.appPool, ...context("spaces-selfleave") },
      "spaces.join",
      { spaceId: defaultSpaceId },
    );
    await callAction(
      { pool: wb.appPool, ...context("spaces-selfleave") },
      "spaces.leave",
      { spaceId: defaultSpaceId },
    );

    expect(await levelOnSpace(member, defaultSpaceId)).toBe(ACCESS_LEVELS.view);
  });

  it("refuses to let the only manager leave a space with members", async () => {
    const wb = await workerDb();
    await addMemberWithUser("spaces-hanger", "Hanger On");
    await callAction(
      { pool: wb.appPool, ...context("spaces-hanger") },
      "spaces.join",
      { spaceId: defaultSpaceId },
    );

    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "spaces.leave", {
        spaceId: defaultSpaceId,
      }),
    ).rejects.toThrow(/only manager/i);
  });

  it("refuses to leave a space they are not in", async () => {
    const wb = await workerDb();
    await addMemberWithUser("spaces-stranger", "Stranger");

    await expect(
      callAction(
        { pool: wb.appPool, ...context("spaces-stranger") },
        "spaces.leave",
        { spaceId: defaultSpaceId },
      ),
    ).rejects.toThrow(/not in this space/i);
  });
});

describe("who may administer a space", () => {
  it("lets a space manager who is not a workspace admin do it", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.create",
      { name: "Marketing" },
    );
    const manager = await addMemberWithUser("spaces-mgr", "Space Manager");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: created.id, memberId: manager, role: "manager" },
    );

    // This member holds `edit` on the workspace through workspace_standard, and
    // nothing more. Renaming the space works through their space binding alone.
    const renamed = await callAction(
      { pool: wb.appPool, ...context("spaces-mgr") },
      "spaces.update",
      { id: created.id, name: "Growth" },
    );
    expect(renamed.name).toBe("Growth");
  });

  it("refuses an ordinary member who is only a viewer of it", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.create",
      { name: "Finance" },
    );
    await addMemberWithUser("spaces-nobody", "Nobody Much");

    await expect(
      callAction(
        { pool: wb.appPool, ...context("spaces-nobody") },
        "spaces.update",
        { id: created.id, name: "Renamed" },
      ),
    ).rejects.toThrow();
  });

  it("lets a workspace admin administer a space they are not a member of", async () => {
    const wb = await workerDb();
    const manager = await addMemberWithUser("spaces-mgr2", "Other Manager");
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.create",
      { name: "Support", managerMemberId: manager },
    );

    // The owner is not in this space at all, so their only space binding is the
    // workspace_standard view. The second authorisation path in
    // `requireSpaceAdmin` is what lets them repair it.
    const detail = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.read",
      { id: created.id },
    );
    expect(detail.ownRole).toBe(null);

    const renamed = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.update",
      { id: created.id, name: "Customer Support" },
    );
    expect(renamed.name).toBe("Customer Support");
  });
});

describe("archiving", () => {
  it("drops the space from the list and refuses to read it", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.create",
      { name: "Temporary" },
    );

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.archive",
      { id: created.id },
    );

    const listed = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.list",
      {},
    );
    expect(listed.map((row) => row.id)).not.toContain(created.id);

    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "spaces.read", {
        id: created.id,
      }),
    ).rejects.toThrow();
  });
});

describe("the list", () => {
  it("counts members and reports the reader's own role", async () => {
    const wb = await workerDb();
    const member = await addMemberWithUser("spaces-counted", "Counted");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.addMember",
      { spaceId: defaultSpaceId, memberId: member, role: "member" },
    );

    const asOwner = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "spaces.list",
      {},
    );
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0]?.memberCount).toBe(2);
    expect(asOwner[0]?.ownRole).toBe("manager");

    const asMember = await callAction(
      { pool: wb.appPool, ...context("spaces-counted") },
      "spaces.list",
      {},
    );
    expect(asMember[0]?.ownRole).toBe("member");
  });

  it("shows a space to a member who is not in it, with no role", async () => {
    const wb = await workerDb();
    await addMemberWithUser("spaces-viewer", "Viewer");

    const listed = await callAction(
      { pool: wb.appPool, ...context("spaces-viewer") },
      "spaces.list",
      {},
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.ownRole).toBe(null);
  });
});
