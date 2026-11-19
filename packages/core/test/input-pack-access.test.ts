import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { createAuth } from "../src/auth/auth.ts";
import { INPUT_PACK_REFUSAL } from "../src/cycles/input-pack-access.ts";
import { buildDemoWorkspace } from "../src/demo/builder.ts";
import { prepareDemoPersonas } from "../src/demo/personas.ts";
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
const NO_ROLE = "pack-no-role";
const NO_ROLE_FACILITATOR = "pack-no-role-facilitator";

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
    NO_ROLE,
    NO_ROLE_FACILITATOR,
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
    NO_ROLE,
    NO_ROLE_FACILITATOR,
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

  it("a member with no role may not, facilitator or not (F-05)", async () => {
    // role_id is null here: what demo:prepare and imported members have.
    await setFacilitator(null);
    await expect(mark(NO_ROLE)).rejects.toThrow(INPUT_PACK_REFUSAL);
    await expect(distribute(NO_ROLE)).rejects.toThrow(INPUT_PACK_REFUSAL);
    // A named facilitator with no role fails isMemberOrAbove (no role is
    // not Member), as the rule's own comment says.
    await setFacilitator(NO_ROLE_FACILITATOR);
    await expect(mark(NO_ROLE_FACILITATOR)).rejects.toThrow(INPUT_PACK_REFUSAL);
    await expect(distribute(NO_ROLE_FACILITATOR)).rejects.toThrow(
      INPUT_PACK_REFUSAL,
    );
    // Another no-role member is refused while a no-role one is facilitator.
    await expect(mark(NO_ROLE)).rejects.toThrow(INPUT_PACK_REFUSAL);
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
      [NO_ROLE]: false,
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

describe("prepared demo Members and the input pack", () => {
  it("allows only the named facilitator among prepared demo Members to change the pack", async () => {
    const wb = await workerDb();
    const DEMO_OWNER = "demo-pack-owner";
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [DEMO_OWNER, "Demo Pack Owner", "demo-pack-owner@example.com"],
    );
    const demoWsId = (
      await provisionWorkspaceForUser(wb.appPool, {
        id: DEMO_OWNER,
        name: "Northwind Pack Demo",
      })
    ).workspaceId;

    await buildDemoWorkspace({
      pool: wb.appPool,
      workspaceId: demoWsId,
      adminUserId: DEMO_OWNER,
    });

    const demoAuth = createAuth({
      pool: wb.appPool,
      secret: "pack-test-secret-long-enough-for-signing",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });

    await prepareDemoPersonas({
      pool: wb.appPool,
      workspaceId: demoWsId,
      adminUserId: DEMO_OWNER,
      auth: demoAuth,
    });

    // Priya Raman and Daniel Osei
    const { rows: memberRows } = await wb.admin.query<{
      id: string;
      name: string;
      user_id: string;
    }>(
      `select id, name, user_id from workspace_members
        where workspace_id = $1 and name in ('Priya Raman', 'Daniel Osei')`,
      [demoWsId],
    );
    const priya = memberRows.find((m) => m.name === "Priya Raman");
    const daniel = memberRows.find((m) => m.name === "Daniel Osei");
    if (!priya?.user_id || !daniel?.user_id) {
      throw new Error("Missing Priya or Daniel in seeded demo workspace.");
    }

    // Active cycle in this seeded demo workspace
    const { rows: cycleRows } = await wb.admin.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on desc limit 1",
      [demoWsId],
    );
    const targetCycleId = cycleRows[0]?.id;
    if (!targetCycleId) {
      throw new Error("Missing active cycle in seeded demo workspace.");
    }

    // Set Priya as facilitator
    await wb.admin.query(
      "update cycles set facilitator_id = $1 where id = $2",
      [priya.id, targetCycleId],
    );

    const priyaCtx = {
      pool: wb.appPool,
      workspaceId: demoWsId,
      actor: { kind: "human" as const, userId: priya.user_id },
    };
    const danielCtx = {
      pool: wb.appPool,
      workspaceId: demoWsId,
      actor: { kind: "human" as const, userId: daniel.user_id },
    };

    // Priya (facilitator) reads the pack: canChange is true
    const priyaRead = await callAction(priyaCtx, "workflow.read", {
      cycleId: targetCycleId,
    });
    expect(priyaRead.packAccess).toEqual({
      canChange: true,
      facilitatorName: "Priya Raman",
    });

    // Priya can write the pack
    await callAction(priyaCtx, "workflow.setPackItem", {
      cycleId: targetCycleId,
      itemKey: 1,
      gathered: true,
      note: "Priya gathered this",
    });

    // Daniel (not facilitator) reads the pack: canChange is false
    const danielRead = await callAction(danielCtx, "workflow.read", {
      cycleId: targetCycleId,
    });
    expect(danielRead.packAccess).toEqual({
      canChange: false,
      facilitatorName: "Priya Raman",
    });

    // Daniel is refused
    await expect(
      callAction(danielCtx, "workflow.setPackItem", {
        cycleId: targetCycleId,
        itemKey: 1,
        gathered: false,
      }),
    ).rejects.toThrow(INPUT_PACK_REFUSAL);

    await expect(
      callAction(danielCtx, "workflow.distributePack", {
        cycleId: targetCycleId,
      }),
    ).rejects.toThrow(INPUT_PACK_REFUSAL);
  });
});
