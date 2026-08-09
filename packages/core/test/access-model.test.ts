import {
  type AccessGroupKind,
  accessContexts,
  accessGroups,
} from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
} from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { derivePrivacy } from "../src/access/privacy.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The relationship access model (P2-T01 test plan, TECHNICAL-PLAN §4.1).
 *
 * Three things this task promises: a newly created aggregate gets its context
 * and bindings atomically, the privacy label derives correctly from whichever
 * group tiers hold a live binding, and revoking a binding is reflected the
 * moment it is asked again, because nothing about it is cached.
 *
 * `can()`, the thing that resolves what one member is actually allowed to do
 * with a level, is P2-T02. These tests stop at what P2-T01 delivers: the
 * model and the wiring, not the enforcement built on top of it.
 */

describe("derivePrivacy", () => {
  const cases: Array<[readonly AccessGroupKind[], string]> = [
    [[], "invite-only"],
    [["member"], "invite-only"],
    [["space_standard"], "space"],
    [["member", "space_standard"], "space"],
    [["workspace_standard"], "workspace"],
    [["workspace_standard", "space_standard"], "workspace"],
    [["anonymous"], "public"],
    [["anonymous", "workspace_standard", "space_standard", "member"], "public"],
  ];

  for (const [kinds, expected] of cases) {
    it(`reads "${expected}" for [${kinds.join(", ") || "none"}]`, () => {
      expect(derivePrivacy(kinds)).toBe(expected);
    });
  }
});

const USER = "access-model-user";

let workspaceId: string;
let memberId: string;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [USER, "Access Model User", "access-model@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: USER,
    name: "Access Model User",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("workspace provisioning wires the access model", () => {
  it("gives the workspace its own context, standard group, and the first member a full binding through their own group", async () => {
    const wb = await workerDb();

    const contexts = await wb.admin.query(
      "select id, resource_type, resource_id from access_contexts where workspace_id = $1",
      [workspaceId],
    );
    expect(contexts.rows).toHaveLength(1);
    expect(contexts.rows[0].resource_type).toBe("workspace");
    expect(contexts.rows[0].resource_id).toBe(workspaceId);

    const groups = await wb.admin.query(
      "select id, kind, member_id from access_groups where workspace_id = $1 order by kind",
      [workspaceId],
    );
    expect(groups.rows).toHaveLength(2);
    expect(groups.rows.map((r) => r.kind)).toEqual([
      "member",
      "workspace_standard",
    ]);
    const memberGroup = groups.rows.find((r) => r.kind === "member");
    expect(memberGroup).toBeDefined();
    expect(memberGroup.member_id).toBe(memberId);

    const bindings = await wb.admin.query(
      "select group_id, context_id, level, tag from access_bindings where workspace_id = $1",
      [workspaceId],
    );
    expect(bindings.rows).toHaveLength(1);
    expect(bindings.rows[0].level).toBe(ACCESS_LEVELS.full);
    expect(bindings.rows[0].tag).toBeNull();
    expect(bindings.rows[0].group_id).toBe(memberGroup.id);
    expect(bindings.rows[0].context_id).toBe(contexts.rows[0].id);
  });

  it("does not duplicate the workspace_standard or member group on a second call", async () => {
    const wb = await workerDb();

    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.reensure",
        workspaceId,
        actor: { kind: "human", userId: USER },
        async execute({ tx }) {
          await ensureWorkspaceStandardGroup(tx, { workspaceId });
          await ensureMemberGroup(tx, { workspaceId, memberId });
          return {
            result: undefined,
            activity: {
              kind: "test.reensure",
              subjectType: "workspace",
              subjectId: workspaceId,
            },
            audit: { action: "test.reensure", targetType: "workspace" },
          };
        },
      },
    );

    const groups = await wb.admin.query(
      "select count(*)::int as n from access_groups where workspace_id = $1",
      [workspaceId],
    );
    expect(groups.rows[0].n).toBe(2);
  });

  it("rolls back every access row an operation wrote when it fails afterwards", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query(
      "select (select count(*) from access_contexts) as c, (select count(*) from access_groups) as g, (select count(*) from access_bindings) as b",
    );

    await expect(
      runOperation(
        { pool: wb.appPool },
        {
          action: "test.fail-after-write",
          workspaceId,
          actor: { kind: "human", userId: USER },
          async execute({ tx }) {
            const contextId = await ensureContext(tx, {
              workspaceId,
              resourceType: "test-aggregate",
              resourceId: memberId,
            });
            const groupId = await ensureWorkspaceStandardGroup(tx, {
              workspaceId,
            });
            await bindGroup(tx, {
              workspaceId,
              groupId,
              contextId,
              level: ACCESS_LEVELS.view,
            });
            throw new Error("deliberate failure after the writes");
          },
        },
      ),
    ).rejects.toThrow("deliberate failure after the writes");

    const after = await wb.admin.query(
      "select (select count(*) from access_contexts) as c, (select count(*) from access_groups) as g, (select count(*) from access_bindings) as b",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("privacy recomputes the moment a binding changes, because nothing caches it", () => {
  it("drops from workspace to space visibility the instant the workspace binding is revoked", async () => {
    const wb = await workerDb();
    const spaceId = "00000000-0000-4000-8000-000000000001";

    const liveKinds = async (): Promise<AccessGroupKind[]> => {
      const rows = await wb.admin.query<{ kind: AccessGroupKind }>(
        `select g.kind
           from access_bindings b
           join access_groups g on g.id = b.group_id
          where b.context_id = (
            select id from access_contexts where workspace_id = $1 limit 1
          )
            and b.deleted_at is null
            and g.deleted_at is null`,
        [workspaceId],
      );
      return rows.rows.map((row) => row.kind);
    };

    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.wire-tiers",
        workspaceId,
        actor: { kind: "human", userId: USER },
        async execute({ tx }) {
          const [context] = await tx
            .select({ id: accessContexts.id })
            .from(accessContexts)
            .where(eq(accessContexts.workspaceId, workspaceId))
            .limit(1);
          const contextId = (context as { id: string }).id;

          const workspaceGroupId = await ensureWorkspaceStandardGroup(tx, {
            workspaceId,
          });
          // openokr:allow-mutation: test setup for a space-tier group, on the
          // same transaction the surrounding operation opened. Spaces
          // themselves are P3-T01; this exercises the space_standard kind
          // ahead of a space existing to create one.
          const [spaceGroup] = await tx
            .insert(accessGroups)
            .values({ workspaceId, kind: "space_standard", spaceId })
            .returning({ id: accessGroups.id });

          await bindGroup(tx, {
            workspaceId,
            groupId: workspaceGroupId,
            contextId,
            level: ACCESS_LEVELS.view,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId: (spaceGroup as { id: string }).id,
            contextId,
            level: ACCESS_LEVELS.edit,
          });

          return {
            result: undefined,
            activity: {
              kind: "test.wire-tiers",
              subjectType: "workspace",
              subjectId: workspaceId,
            },
            audit: { action: "test.wire-tiers", targetType: "workspace" },
          };
        },
      },
    );

    expect(derivePrivacy(await liveKinds())).toBe("workspace");

    // Revoke the workspace-tier binding by soft-deleting it directly, the way
    // a future revoke operation will.
    await wb.admin.query(
      `update access_bindings set deleted_at = now()
        where workspace_id = $1
          and group_id = (
            select id from access_groups
             where workspace_id = $1 and kind = 'workspace_standard'
          )`,
      [workspaceId],
    );

    expect(derivePrivacy(await liveKinds())).toBe("space");
  });
});
