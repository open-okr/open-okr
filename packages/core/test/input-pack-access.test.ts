import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { INPUT_PACK_REFUSAL } from "../src/cycles/input-pack-access.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Who may change the input pack (docs/design/input-pack-access.md, plan 0.9.0
 * G8), row by row from §3, through `callAction` so the REST, command line and
 * agent surfaces, which are projections of the same action, are covered too.
 *
 * Marking an item, its note and Confirm distribution are open to the Owner,
 * an Admin and the cycle's named facilitator, and the facilitator only with a
 * role of Member or above (Q1). Every other member holds `edit` on the
 * workspace context for self-service, which is why this needed a rule of its
 * own.
 */

const OWNER = "pack-owner";
const ADMIN = "pack-admin";
const FACILITATOR = "pack-facilitator";
const MEMBER = "pack-member";
const VIEWER_FACILITATOR = "pack-viewer-facilitator";
const SUSPENDED_FACILITATOR = "pack-suspended-facilitator";
const EDITOR = "pack-editor";
const GUEST = "pack-guest";

let workspaceId: string;
let cycleId: string;
const memberIds = new Map<string, string>();
let agentMemberId: string;

async function as(userId: string) {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
}

async function setFacilitator(userId: string | null) {
  const wb = await workerDb();
  await wb.admin.query("update cycles set facilitator_id = $1 where id = $2", [
    userId ? (memberIds.get(userId) as string) : null,
    cycleId,
  ]);
}

const mark = async (userId: string, gathered = true) =>
  callAction(await as(userId), "workflow.setPackItem", {
    cycleId,
    itemKey: 1,
    gathered,
    note: "The readout is with Priya",
  });

const distribute = async (userId: string) =>
  callAction(await as(userId), "workflow.distributePack", { cycleId });

/** How many rows the two pack actions have written to the trail. */
async function trailRows(): Promise<{ activity: number; audit: number }> {
  const wb = await workerDb();
  const activity = await wb.admin.query<{ n: string }>(
    "select count(*)::text as n from activities where workspace_id = $1 and kind in ('cycle.pack_item_set', 'cycle.pack_distributed')",
    [workspaceId],
  );
  const audit = await wb.admin.query<{ n: string }>(
    "select count(*)::text as n from audit_events where workspace_id = $1 and action in ('workflow.setPackItem', 'workflow.distributePack')",
    [workspaceId],
  );
  return {
    activity: Number(activity.rows[0]?.n),
    audit: Number(audit.rows[0]?.n),
  };
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  memberIds.clear();
  const people = [
    OWNER,
    ADMIN,
    FACILITATOR,
    MEMBER,
    VIEWER_FACILITATOR,
    SUSPENDED_FACILITATOR,
    EDITOR,
    GUEST,
  ];
  for (const id of people) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [id, id, `${id}@example.com`],
    );
  }
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: OWNER })
  ).workspaceId;

  for (const id of [
    ADMIN,
    FACILITATOR,
    MEMBER,
    VIEWER_FACILITATOR,
    SUSPENDED_FACILITATOR,
    EDITOR,
  ]) {
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
       values (gen_random_uuid(), $1, $2, $2, 'active', 'human') returning id`,
      [workspaceId, id],
    );
    memberIds.set(id, row.rows[0]?.id as string);
  }
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
    [FACILITATOR, "member"],
    [MEMBER, "member"],
    [VIEWER_FACILITATOR, "viewer"],
    [SUSPENDED_FACILITATOR, "member"],
  ] as const) {
    await callAction(owner, "roles.assign", {
      memberId: memberIds.get(id) as string,
      roleId: builtin(key),
    });
  }
  // A role the workspace made, granting edit on the workspace domain.
  const editor = (await callAction(owner, "roles.create", {
    name: "Cycle editor",
  } as never)) as { id: string };
  await callAction(owner, "roles.setPermission", {
    roleId: editor.id,
    domain: "workspace",
    level: 70,
  });
  await callAction(owner, "roles.assign", {
    memberId: memberIds.get(EDITOR) as string,
    roleId: editor.id,
  });

  const on = new Date();
  on.setUTCMonth(on.getUTCMonth() + 3);
  const cycle = (await callAction(owner, "cycles.create", {
    on: on.toISOString().slice(0, 10),
  } as never)) as { id: string };
  cycleId = cycle.id;

  const agent = await wb.admin.query<{ member_id: string }>(
    "select member_id from agents where workspace_id = $1 and kind = 'champion'",
    [workspaceId],
  );
  agentMemberId = agent.rows[0]?.member_id as string;
});

describe("who may change the pack (§3)", () => {
  it("the Owner and an Admin may, with or without a facilitator", async () => {
    for (const id of [OWNER, ADMIN]) {
      await setFacilitator(null);
      await expect(mark(id)).resolves.toMatchObject({ itemKey: 1 });
      await setFacilitator(FACILITATOR);
      await expect(distribute(id)).resolves.toHaveProperty("distributedAt");
    }
  });

  it("a role the workspace made, granting edit on the workspace, may", async () => {
    await expect(mark(EDITOR)).resolves.toMatchObject({ itemKey: 1 });
  });

  it("a Member who is the named facilitator may, and the trail records it", async () => {
    await setFacilitator(FACILITATOR);
    const before = await trailRows();
    await expect(mark(FACILITATOR)).resolves.toMatchObject({ itemKey: 1 });
    await expect(distribute(FACILITATOR)).resolves.toHaveProperty(
      "distributedAt",
    );
    const after = await trailRows();
    expect(after.activity - before.activity).toBe(2);
    expect(after.audit - before.audit).toBe(2);
  });

  it("a Member who is not the facilitator may not, and nothing is written", async () => {
    await setFacilitator(FACILITATOR);
    const before = await trailRows();
    await expect(mark(MEMBER)).rejects.toThrow(INPUT_PACK_REFUSAL);
    await expect(distribute(MEMBER)).rejects.toThrow(INPUT_PACK_REFUSAL);
    expect(await trailRows()).toEqual(before);

    const wb = await workerDb();
    const items = await wb.admin.query<{ gathered: boolean }>(
      "select gathered from cycle_pack_items where cycle_id = $1 and gathered",
      [cycleId],
    );
    expect(items.rows).toHaveLength(0);
    const cycle = await wb.admin.query<{ pack_distributed_at: Date | null }>(
      "select pack_distributed_at from cycles where id = $1",
      [cycleId],
    );
    expect(cycle.rows[0]?.pack_distributed_at).toBeNull();
  });

  it("a Member with no facilitator named may not", async () => {
    await setFacilitator(null);
    await expect(mark(MEMBER)).rejects.toThrow(INPUT_PACK_REFUSAL);
    await expect(distribute(MEMBER)).rejects.toThrow(INPUT_PACK_REFUSAL);
  });

  it("a Viewer named facilitator may not (Q1)", async () => {
    await setFacilitator(VIEWER_FACILITATOR);
    await expect(mark(VIEWER_FACILITATOR)).rejects.toThrow();
    await expect(distribute(VIEWER_FACILITATOR)).rejects.toThrow();
  });

  it("a suspended facilitator is refused, and the Owner still may", async () => {
    await setFacilitator(SUSPENDED_FACILITATOR);
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberIds.get(SUSPENDED_FACILITATOR) as string],
    );
    await expect(mark(SUSPENDED_FACILITATOR)).rejects.toThrow();
    await expect(mark(OWNER)).resolves.toMatchObject({ itemKey: 1 });
  });

  it("a guest and an agent may not", async () => {
    await expect(mark(GUEST)).rejects.toThrow();
    const wb = await workerDb();
    const agent = {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "agent" as const, memberId: agentMemberId },
    };
    await expect(
      callAction(agent, "workflow.setPackItem", {
        cycleId,
        itemKey: 1,
        gathered: true,
      }),
    ).rejects.toThrow();
    await expect(
      callAction(agent, "workflow.distributePack", { cycleId }),
    ).rejects.toThrow();
  });
});

describe("workflow.read packAccess agrees with the writes", () => {
  it("answers canChange and the facilitator's name for each actor", async () => {
    await setFacilitator(FACILITATOR);
    const expected: Record<string, boolean> = {
      [OWNER]: true,
      [ADMIN]: true,
      [EDITOR]: true,
      [FACILITATOR]: true,
      [MEMBER]: false,
      [VIEWER_FACILITATOR]: false,
    };
    for (const [id, canChange] of Object.entries(expected)) {
      const read = await callAction(await as(id), "workflow.read", {
        cycleId,
      });
      expect(read.packAccess, id).toEqual({
        canChange,
        facilitatorName: FACILITATOR,
      });
    }
  });

  it("has no name when nobody named may change the pack", async () => {
    await setFacilitator(null);
    const none = await callAction(await as(MEMBER), "workflow.read", {
      cycleId,
    });
    expect(none.packAccess).toEqual({
      canChange: false,
      facilitatorName: null,
    });

    await setFacilitator(VIEWER_FACILITATOR);
    const viewer = await callAction(await as(MEMBER), "workflow.read", {
      cycleId,
    });
    expect(viewer.packAccess).toEqual({
      canChange: false,
      facilitatorName: null,
    });
  });
});
