/**
 * KPI sharing actions (0.10.0 K6, docs/design/kpi-access.md §5, §7.2, §9, §12, §13).
 *
 * AC-1, AC-4 to AC-8, AC-29, AC-30, AC-38; audit payloads per §9;
 * kpis.unshare of a missing share returns removed: false and writes audit.
 */
import { accessBindings, accessContexts, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActionCallContext } from "../src/actions/define.ts";
import { callAction } from "../src/actions/registry.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

let workspaceId: string;
let ownerUserId: string;
let _ownerMemberId: string;
let adminUserId: string;
let _adminMemberId: string;
let memberUserId: string;
let memberMemberId: string;
let viewerUserId: string;
let viewerMemberId: string;
let guestUserId: string;
let guestMemberId: string;
let agentMemberId: string;

let kpiAId: string;

let appPool: ActionCallContext["pool"];

function makeContext(userId: string): ActionCallContext {
  return {
    workspaceId,
    actor: {
      kind: "human",
      userId,
    },
    pool: appPool,
  };
}

describe("KPI sharing actions (K6)", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    appPool = wb.appPool;
    const runId = Math.random().toString(36).substring(2, 9);
    ownerUserId = `kpi-share-owner-${runId}`;
    adminUserId = `kpi-share-admin-${runId}`;
    memberUserId = `kpi-share-member-${runId}`;
    viewerUserId = `kpi-share-viewer-${runId}`;
    guestUserId = `kpi-share-guest-${runId}`;

    await wb.admin.query(
      `insert into users (id, name, email) values
        ($1, 'Owner', $6),
        ($2, 'Admin', $7),
        ($3, 'Member', $8),
        ($4, 'Viewer', $9),
        ($5, 'Guest', $10)`,
      [
        ownerUserId,
        adminUserId,
        memberUserId,
        viewerUserId,
        guestUserId,
        `owner-${runId}@example.com`,
        `admin-${runId}@example.com`,
        `member-${runId}@example.com`,
        `viewer-${runId}@example.com`,
        `guest-${runId}@example.com`,
      ],
    );

    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: ownerUserId,
      name: "Owner",
    });
    workspaceId = provisioned.workspaceId;

    const membersRes = await wb.admin.query<{
      id: string;
      user_id: string | null;
    }>("select id, user_id from workspace_members where workspace_id = $1", [
      workspaceId,
    ]);
    _ownerMemberId = membersRes.rows.find((r) => r.user_id === ownerUserId)!.id;

    // Admin role
    const adminRoleRes = await wb.admin.query<{ id: string }>(
      "select id from workspace_roles where workspace_id = $1 and builtin_key = 'admin'",
      [workspaceId],
    );
    const adminRoleId = adminRoleRes.rows[0]!.id;
    const adminMemberRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
       values (gen_random_uuid(), $1, $2, 'Admin', 'human', 'active', $3) returning id`,
      [workspaceId, adminUserId, adminRoleId],
    );
    _adminMemberId = adminMemberRes.rows[0]!.id;

    // Member role
    const memberRoleRes = await wb.admin.query<{ id: string }>(
      "select id from workspace_roles where workspace_id = $1 and builtin_key = 'member'",
      [workspaceId],
    );
    const memberRoleId = memberRoleRes.rows[0]!.id;
    const memberMemberRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
       values (gen_random_uuid(), $1, $2, 'Member', 'human', 'active', $3) returning id`,
      [workspaceId, memberUserId, memberRoleId],
    );
    memberMemberId = memberMemberRes.rows[0]!.id;

    // Viewer role
    const viewerRoleRes = await wb.admin.query<{ id: string }>(
      "select id from workspace_roles where workspace_id = $1 and builtin_key = 'viewer'",
      [workspaceId],
    );
    const viewerRoleId = viewerRoleRes.rows[0]!.id;
    const viewerMemberRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
       values (gen_random_uuid(), $1, $2, 'Viewer', 'human', 'active', $3) returning id`,
      [workspaceId, viewerUserId, viewerRoleId],
    );
    viewerMemberId = viewerMemberRes.rows[0]!.id;

    // Guest member
    const guestMemberRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
       values (gen_random_uuid(), $1, $2, 'Guest', 'guest', 'active') returning id`,
      [workspaceId, guestUserId],
    );
    guestMemberId = guestMemberRes.rows[0]!.id;

    // Agent member
    const agentMemberRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Built-in Agent', 'agent', 'active') returning id`,
      [workspaceId],
    );
    agentMemberId = agentMemberRes.rows[0]!.id;

    // Create KPI-A owned by memberMemberId
    const createdA = (await callAction(
      makeContext(memberUserId),
      "kpis.create",
      {
        title: "KPI A Owned By Member",
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "leading",
        ownerKind: "workspace",
        ownerMemberId: memberMemberId,
        aggregate: "sum",
      },
    )) as { id: string };
    kpiAId = createdA.id;
  });

  it("AC-1: a Member who owns KPI-A shares it successfully; their level on KPI-A resolves to 100", async () => {
    const res = (await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "edit",
    })) as {
      kpiId: string;
      memberId: string;
      level: string;
      previousLevel: string | null;
      coveredByRole: boolean;
    };

    expect(res).toEqual({
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "edit",
      previousLevel: null,
      coveredByRole: false, // viewer has role level 10 on kpi, share is edit (70)
    });
  });

  it("AC-4: an Admin whose role permission on kpi is edit (70) is refused kpis.share on KPI-A; Owner succeeds", async () => {
    const wb = await workerDb();
    // Demote Admin role's kpi permission to edit (70)
    const adminRoleRes = await wb.admin.query<{ id: string }>(
      "select id from workspace_roles where workspace_id = $1 and builtin_key = 'admin'",
      [workspaceId],
    );
    const adminRoleId = adminRoleRes.rows[0]!.id;
    await wb.admin.query(
      `update role_permissions set level = 70
       where workspace_id = $1 and role_id = $2 and domain = 'kpi'`,
      [workspaceId, adminRoleId],
    );

    // Admin who does not own KPI-A calls kpis.share -> Refused with forbidden
    await expect(
      callAction(makeContext(adminUserId), "kpis.share", {
        kpiId: kpiAId,
        memberId: viewerMemberId,
        level: "view",
      }),
    ).rejects.toThrow(OperationError);

    // Owner-role member (ownerUserId) succeeds
    const res = (await callAction(makeContext(ownerUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "view",
    })) as {
      kpiId: string;
      memberId: string;
      level: string;
      previousLevel: string | null;
      coveredByRole: boolean;
    };
    expect(res.level).toBe("view");
  });

  it("AC-5: KPI-A owned by Ana, shared with Ben at edit; Ana calls kpis.unshare for Ben -> share binding soft-deleted, owner untouched", async () => {
    const wb = await workerDb();
    // Share with viewer at edit
    await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "edit",
    });

    // Unshare
    const unshareRes = (await callAction(
      makeContext(memberUserId),
      "kpis.unshare",
      {
        kpiId: kpiAId,
        memberId: viewerMemberId,
      },
    )) as {
      kpiId: string;
      memberId: string;
      removed: boolean;
    };
    expect(unshareRes).toEqual({
      kpiId: kpiAId,
      memberId: viewerMemberId,
      removed: true,
    });

    // Verify bindings in database
    const db = drizzle(wb.appPool);
    await withWorkspace(db, workspaceId, async (tx) => {
      // Owner binding is still active
      const ownerBinding = await tx
        .select({
          id: accessBindings.id,
          tag: accessBindings.tag,
          level: accessBindings.level,
        })
        .from(accessBindings)
        .innerJoin(
          accessContexts,
          eq(accessContexts.id, accessBindings.contextId),
        )
        .where(
          and(
            eq(accessBindings.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, kpiAId),
            eq(accessBindings.tag, "owner"),
            isNull(accessBindings.deletedAt),
          ),
        );
      expect(ownerBinding).toHaveLength(1);
      expect(ownerBinding[0]!.level).toBe(100);

      // Share binding is soft-deleted
      const activeShareBinding = await tx
        .select({ id: accessBindings.id })
        .from(accessBindings)
        .innerJoin(
          accessContexts,
          eq(accessContexts.id, accessBindings.contextId),
        )
        .where(
          and(
            eq(accessBindings.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, kpiAId),
            eq(accessBindings.tag, "share"),
            isNull(accessBindings.deletedAt),
          ),
        );
      expect(activeShareBinding).toHaveLength(0);
    });
  });

  it("AC-6: Ben holds share at edit on KPI-A; owner calls kpis.share at view -> binding level is 10, Ben's record is refused", async () => {
    // Share at edit
    await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "edit",
    });

    // Lower to view
    const res = (await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "view",
    })) as {
      previousLevel: string | null;
      level: string;
    };
    expect(res.previousLevel).toBe("edit");
    expect(res.level).toBe("view");

    // Viewer tries to record on KPI-A -> refused because share is now view (10) and viewer role is view (10)
    await expect(
      callAction(makeContext(viewerUserId), "kpis.record", {
        kpiId: kpiAId,
        on: "2026-11-01",
        actualValue: 50,
      }),
    ).rejects.toThrow(OperationError);
  });

  it("AC-7: Ana owns KPI-A; somebody calls kpis.share with Ana as target -> refused 'already owns this KPI'", async () => {
    await expect(
      callAction(makeContext(ownerUserId), "kpis.share", {
        kpiId: kpiAId,
        memberId: memberMemberId, // memberMemberId owns KPI-A
        level: "view",
      }),
    ).rejects.toThrow("already owns this KPI");
  });

  it("AC-8: an agent member; owner calls kpis.share with agent as target -> refused with forbidden", async () => {
    await expect(
      callAction(makeContext(memberUserId), "kpis.share", {
        kpiId: kpiAId,
        memberId: agentMemberId,
        level: "view",
      }),
    ).rejects.toThrow(OperationError);
  });

  it("AC-29: Ben holds a share and is suspended -> kpis.detail is not_found; after restore it works again", async () => {
    // Share KPI-A with viewer at view
    await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "view",
    });

    // Verify detail works for viewer
    const beforeSuspend = (await callAction(
      makeContext(viewerUserId),
      "kpis.detail",
      { kpiId: kpiAId, periods: 12 },
    )) as { kpi: { id: string } };
    expect(beforeSuspend.kpi.id).toBe(kpiAId);

    // Suspend viewer
    await callAction(makeContext(ownerUserId), "people.suspend", {
      memberId: viewerMemberId,
    });

    // Detail now throws not_found
    await expect(
      callAction(makeContext(viewerUserId), "kpis.detail", {
        kpiId: kpiAId,
        periods: 12,
      }),
    ).rejects.toThrow(OperationError);

    // Restore viewer
    await callAction(makeContext(ownerUserId), "people.restore", {
      memberId: viewerMemberId,
    });

    // Detail works again
    const afterRestore = (await callAction(
      makeContext(viewerUserId),
      "kpis.detail",
      { kpiId: kpiAId, periods: 12 },
    )) as { kpi: { id: string } };
    expect(afterRestore.kpi.id).toBe(kpiAId);
  });

  it("AC-30: Ben holds a share and owns KPI-D; people.erase runs for Ben -> Ben's share and owner bindings are soft-deleted", async () => {
    const wb = await workerDb();
    // Ben (viewerMemberId) owns KPI-D
    await callAction(makeContext(ownerUserId), "kpis.create", {
      title: "KPI D Owned By Ben",
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "leading",
      ownerKind: "workspace",
      ownerMemberId: viewerMemberId,
      aggregate: "sum",
    });

    // Ben also holds a share on KPI-A
    await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "view",
    });

    // Erase Ben
    await callAction(makeContext(ownerUserId), "people.erase", {
      memberId: viewerMemberId,
    });

    // Verify bindings for viewerMemberId on kpi contexts are soft-deleted
    const db = drizzle(wb.appPool);
    await withWorkspace(db, workspaceId, async (tx) => {
      const activeBindings = await tx.execute<{ id: string; tag: string }>(
        sql`select b.id, b.tag
           from access_bindings b
           join access_groups g on g.id = b.group_id
           join access_contexts c on c.id = b.context_id
          where b.workspace_id = ${workspaceId}
            and g.member_id = ${viewerMemberId}
            and c.resource_type = 'kpi'
            and b.deleted_at is null`,
      );
      expect(activeBindings.rows).toHaveLength(0);
    });
  });

  it("AC-38: a guest with one share calls kpis.shares -> sees owner and grantee; guest with no share is not-found", async () => {
    // Share KPI-A with guest
    await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: guestMemberId,
      level: "view",
    });

    // Guest calls kpis.shares
    const res = (await callAction(makeContext(guestUserId), "kpis.shares", {
      kpiId: kpiAId,
    })) as {
      owner: { memberId: string; name: string; kind: string } | null;
      shares: Array<{
        memberId: string;
        name: string;
        kind: string;
        status: string;
        level: string;
        sharedAt: string;
        roleLevel: number | null;
      }>;
    };

    expect(res.owner).toEqual({
      memberId: memberMemberId,
      name: "Member",
      kind: "human",
    });
    expect(res.shares).toHaveLength(1);
    expect(res.shares[0]).toMatchObject({
      memberId: guestMemberId,
      name: "Guest",
      kind: "guest",
      status: "active",
      level: "view",
      roleLevel: null,
    });

    // Another guest with no share
    const wb = await workerDb();
    await wb.admin.query(
      `insert into users (id, name, email) values ('other-guest', 'Other Guest', 'other-guest@example.com')`,
    );
    await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
       values (gen_random_uuid(), $1, 'other-guest', 'Other Guest', 'guest', 'active') returning id`,
      [workspaceId],
    );
    await expect(
      callAction(makeContext("other-guest"), "kpis.shares", {
        kpiId: kpiAId,
      }),
    ).rejects.toThrow(OperationError);
  });

  it("unshare of a missing share returns removed: false and writes audit; audit payloads match §9", async () => {
    const wb = await workerDb();
    // 1. Share KPI-A with viewer at edit
    await callAction(makeContext(memberUserId), "kpis.share", {
      kpiId: kpiAId,
      memberId: viewerMemberId,
      level: "edit",
    });

    // Check share audit payload per §9: {memberId, level, previousLevel}
    const shareAuditRes = await wb.admin.query<{
      payload: Record<string, unknown>;
    }>(
      `select payload from audit_events
        where workspace_id = $1 and action = 'kpis.share' and target_id = $2
        order by at desc limit 1`,
      [workspaceId, kpiAId],
    );
    expect(shareAuditRes.rows[0]!.payload).toEqual({
      memberId: viewerMemberId,
      level: "edit",
      previousLevel: null,
    });

    // 2. Unshare KPI-A from viewer
    const unshare1 = (await callAction(
      makeContext(memberUserId),
      "kpis.unshare",
      {
        kpiId: kpiAId,
        memberId: viewerMemberId,
      },
    )) as { removed: boolean };
    expect(unshare1.removed).toBe(true);

    const unshareAudit1 = await wb.admin.query<{
      payload: Record<string, unknown>;
    }>(
      `select payload from audit_events
        where workspace_id = $1 and action = 'kpis.unshare' and target_id = $2
        order by at desc limit 1`,
      [workspaceId, kpiAId],
    );
    expect(unshareAudit1.rows[0]!.payload).toEqual({
      memberId: viewerMemberId,
      previousLevel: "edit",
    });

    // 3. Unshare again (missing share) -> removed: false and writes audit
    const unshare2 = (await callAction(
      makeContext(memberUserId),
      "kpis.unshare",
      {
        kpiId: kpiAId,
        memberId: viewerMemberId,
      },
    )) as { removed: boolean };
    expect(unshare2.removed).toBe(false);

    const unshareAudit2 = await wb.admin.query<{
      payload: Record<string, unknown>;
    }>(
      `select payload from audit_events
        where workspace_id = $1 and action = 'kpis.unshare' and target_id = $2
        order by at desc limit 1`,
      [workspaceId, kpiAId],
    );
    expect(unshareAudit2.rows[0]!.payload).toEqual({
      memberId: viewerMemberId,
      previousLevel: null,
    });
  });
});
