import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sessionRolePermissions } from "../../db/src/data-changes/0036_session_role_permissions.ts";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import type { RichTextDocument } from "../src/rich-text/schema.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A write that creates in a domain asks the role for that domain
 * (docs/design/workspace-roles.md §11, MCP UAT BUG-002).
 *
 * Every member holds `edit` on the workspace's own context for self-service,
 * and a write that named no subject was measured there, so a Viewer created
 * comments and KPIs. These hold the acceptance criteria of §11.
 */

const OWNER = "role-domain-owner";
const PERSON = "role-domain-person";

let workspaceId: string;
let cycleId: string;

const as = async (userId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** A member as an invitation leaves one: `edit` on the workspace context. */
async function addMember(role: "member" | "viewer"): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [PERSON, "Role Domain Person", `${PERSON}@example.com`],
  );
  const inserted = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Role Domain Person', 'human', 'active',
             (select id from workspace_roles where workspace_id = $1 and builtin_key = $3))
     returning id`,
    [workspaceId, PERSON, role],
  );
  const memberId = inserted.rows[0]?.id;
  if (!memberId) {
    throw new Error("insert into workspace_members returned no row");
  }
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-edit",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const subject = await resolveSubjectContext(
          tx,
          "workspace",
          workspaceId,
          workspaceId,
        );
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: (subject as { contextId: string }).contextId,
          level: ACCESS_LEVELS.edit,
        });
        return {
          result: undefined,
          activity: {
            kind: "test.grant-edit",
            subjectType: "workspace_member",
            subjectId: memberId,
          },
          audit: { action: "test.grant-edit", targetType: "workspace_member" },
        };
      },
    },
  );
  return memberId;
}

async function joinTestSpace(memberId: string): Promise<string> {
  const owner = await as(OWNER);
  const { id } = await callAction(owner, "spaces.create", {
    name: "Creation access test team",
  });
  await callAction(owner, "spaces.addMember", {
    spaceId: id,
    memberId,
    role: "member",
  });
  return id;
}

const hi: RichTextDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
};

const comment = () => ({
  subjectType: "cycle" as const,
  subjectId: cycleId,
  body: hi,
});

const kpi = {
  title: "Setup completion rate",
  indicatorType: "lagging" as const,
  aggregate: "sum" as const,
  ownerKind: "workspace" as const,
  frequency: "monthly" as const,
};

const objective = () => ({
  title: "Every new customer live within a week",
  level: "company" as const,
  ownerKind: "workspace" as const,
  weight: 1,
  cycleId,
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Role Domain Owner", `${OWNER}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Role Domain Owner",
    })
  ).workspaceId;
  const cycle = await callAction(await as(OWNER), "cycles.ensureCurrent", {});
  cycleId = (cycle as { id: string }).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

describe("a member holding Viewer", () => {
  let memberId: string;

  beforeEach(async () => {
    memberId = await addMember("viewer");
  });

  it("cannot create tasks or schedule sessions through a space edit grant", async () => {
    const spaceId = await joinTestSpace(memberId);
    const viewer = await as(PERSON);
    await expect(
      callAction(viewer, "spaces.creationAccess", { spaceIds: [spaceId] }),
    ).resolves.toEqual({
      editableSpaceIds: [spaceId],
      canCreateTask: false,
      canCreateInitiative: false,
      canScheduleSession: false,
      canCreateKpi: false,
    });
    await expect(
      callAction(viewer, "tasks.create", { spaceId, title: "Follow up" }),
    ).rejects.toThrow("tasks.create needs a higher access level");
    await expect(
      callAction(viewer, "sessions.create", {
        spaceId,
        facilitatorId: memberId,
        kind: "weekly",
        title: "Weekly check-in",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).rejects.toThrow("sessions.create needs a higher access level");
    await expect(
      callAction(viewer, "sessions.bookCycle", {
        spaceId,
        cycleId,
        facilitatorId: memberId,
        weekday: 1,
        time: "09:00",
      }),
    ).rejects.toThrow("sessions.bookCycle needs a higher access level");
  });

  it("can add key results only to an objective they can edit", async () => {
    const owner = await as(OWNER);
    const { id: editable } = await callAction(owner, "goals.create", {
      ...objective(),
      championId: memberId,
    });
    const { id: viewOnly } = await callAction(owner, "goals.create", {
      ...objective(),
      title: "Reporting is accurate",
    });
    const viewer = await as(PERSON);
    const result = {
      title: "Reduce time to first value",
      baselineValue: 10,
      targetValue: 7,
      weight: 1,
      direction: "reduce" as const,
      indicatorType: "lagging" as const,
    };
    await expect(
      callAction(viewer, "goals.keyResultCreateAccess", {
        goalIds: [editable, viewOnly],
      }),
    ).resolves.toEqual({ editableGoalIds: [editable] });
    await expect(
      callAction(viewer, "goals.addKeyResult", { ...result, goalId: editable }),
    ).resolves.toHaveProperty("id");
    await expect(
      callAction(viewer, "goals.addKeyResult", { ...result, goalId: viewOnly }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("cannot comment, though the workspace binding grants edit", async () => {
    await expect(
      callAction(await as(PERSON), "comments.create", comment()),
    ).rejects.toThrow(
      "comments.create needs a higher access level than you hold.",
    );
  });

  it("cannot create a KPI", async () => {
    await expect(
      callAction(await as(PERSON), "kpis.create", kpi),
    ).rejects.toThrow("kpis.create needs a higher access level than you hold.");
  });

  // workspace-roles.md §13, UAT 0.8.0 F-04: a company or personal objective
  // names no subject, so it too is measured on the role's goal level.
  it("cannot create an objective, and the screens are told so", async () => {
    await expect(
      callAction(await as(PERSON), "goals.create", objective()),
    ).rejects.toThrow(
      "goals.create needs a higher access level than you hold.",
    );
    await expect(
      callAction(await as(PERSON), "goals.createAccess", {}),
    ).resolves.toEqual({ canCreate: false });
  });

  it("still serves themself", async () => {
    await expect(
      callAction(await as(PERSON), "people.updateOwnProfile", {
        timezone: "Asia/Jakarta",
      }),
    ).resolves.toBeDefined();
  });
});

describe("a member holding Member", () => {
  let memberId: string;

  beforeEach(async () => {
    memberId = await addMember("member");
  });

  it("can create tasks and schedule sessions in their editable space", async () => {
    const spaceId = await joinTestSpace(memberId);
    const member = await as(PERSON);
    const { id: otherSpaceId } = await callAction(
      await as(OWNER),
      "spaces.create",
      {
        name: "Another team",
      },
    );
    await expect(
      callAction(member, "spaces.creationAccess", {
        spaceIds: [spaceId, otherSpaceId],
      }),
    ).resolves.toMatchObject({
      editableSpaceIds: [spaceId],
      canCreateTask: true,
      canScheduleSession: true,
    });
    await expect(
      callAction(member, "tasks.create", { spaceId, title: "Follow up" }),
    ).resolves.toHaveProperty("id");
    await expect(
      callAction(member, "sessions.create", {
        spaceId,
        facilitatorId: memberId,
        kind: "weekly",
        title: "Weekly check-in",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).resolves.toHaveProperty("id");
    await expect(
      callAction(member, "tasks.create", {
        spaceId: otherSpaceId,
        title: "Follow up",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("uses the built-in session default until the backfill and preserves saved edits", async () => {
    const spaceId = await joinTestSpace(memberId);
    const owner = await as(OWNER);
    const member = await as(PERSON);
    const { roles } = await callAction(owner, "roles.list", {});
    const memberRole = roles.find((role) => role.builtinKey === "member");
    if (!memberRole) {
      throw new Error("Missing Member role");
    }
    const database = await workerDb();
    await database.admin.query(
      "delete from role_permissions where workspace_id = $1 and domain = 'session'",
      [workspaceId],
    );
    await expect(
      callAction(member, "spaces.creationAccess", { spaceIds: [spaceId] }),
    ).resolves.toMatchObject({ canScheduleSession: true });
    await callAction(owner, "roles.setPermission", {
      roleId: memberRole.id,
      domain: "session",
      level: 0,
    });

    const client = await database.admin.connect();
    try {
      await client.query("begin");
      expect(await sessionRolePermissions.runBatch(client, null)).toMatchObject(
        { rowsChanged: 3 },
      );
      expect(await sessionRolePermissions.runBatch(client, null)).toMatchObject(
        { rowsChanged: 0 },
      );
      await client.query("commit");
    } finally {
      await client.query("rollback");
      client.release();
    }

    await expect(
      callAction(member, "spaces.creationAccess", { spaceIds: [spaceId] }),
    ).resolves.toMatchObject({ canScheduleSession: false });
  });

  it("creates an objective as before, and the screens are told so", async () => {
    await expect(
      callAction(await as(PERSON), "goals.create", objective()),
    ).resolves.toBeDefined();
    await expect(
      callAction(await as(PERSON), "goals.createAccess", {}),
    ).resolves.toEqual({ canCreate: true });
  });

  it("comments and creates a KPI as before", async () => {
    await expect(
      callAction(await as(PERSON), "comments.create", comment()),
    ).resolves.toBeDefined();
    await expect(
      callAction(await as(PERSON), "kpis.create", kpi),
    ).resolves.toBeDefined();
  });
});
