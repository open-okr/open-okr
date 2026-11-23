/**
 * Per-KPI write access enforcement (0.10.0 K5, docs/design/kpi-access.md §5, §7.1, §13).
 *
 * AC-9, AC-10, AC-23; setFormula refused when referenced KPI is hidden; update with hidden parentKpiId throws not_found.
 */
import { type WorkspaceTx, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import type { ActionCallContext } from "../src/actions/define.ts";
import { callAction } from "../src/actions/registry.ts";
import { ensureKpiContextInTx } from "../src/kpis/access.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER_USER = "kpi-write-owner";
const VIEWER_USER = "kpi-write-viewer";
const ZERO_USER = "kpi-write-zero";
const GUEST_USER = "kpi-write-guest";

let currentOwnerUser: string;
let currentViewerUser: string;
let currentZeroUser: string;
let currentGuestUser: string;

let workspaceId: string;
let _ownerMemberId: string;
let viewerMemberId: string;
let zeroMemberId: string;
let guestMemberId: string;

let kpiAId: string;
let kpiBId: string;
let kpiCId: string;

let appPool: ActionCallContext["pool"];

const context = (userId: string): ActionCallContext => ({
  pool: appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

async function withTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

describe("KPI write access enforcement (K5)", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    appPool = wb.appPool;

    const stamp = Math.random().toString(36).slice(2);
    const ownerUser = `${OWNER_USER}-${stamp}`;
    const viewerUser = `${VIEWER_USER}-${stamp}`;
    const zeroUser = `${ZERO_USER}-${stamp}`;
    const guestUser = `${GUEST_USER}-${stamp}`;

    await wb.admin.query(
      `insert into users (id, name, email) values
        ($1, 'Owner', $5),
        ($2, 'Viewer', $6),
        ($3, 'Zero', $7),
        ($4, 'Guest', $8)`,
      [
        ownerUser,
        viewerUser,
        zeroUser,
        guestUser,
        `owner-${stamp}@example.com`,
        `viewer-${stamp}@example.com`,
        `zero-${stamp}@example.com`,
        `guest-${stamp}@example.com`,
      ],
    );

    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: ownerUser,
      name: "Owner",
    });
    workspaceId = provisioned.workspaceId;

    const members = await wb.admin.query<{
      id: string;
      user_id: string | null;
    }>("select id, user_id from workspace_members where workspace_id = $1", [
      workspaceId,
    ]);
    _ownerMemberId = members.rows.find((row) => row.user_id === ownerUser)!.id;

    // Add viewer member
    const viewerRoleRes = await wb.admin.query<{ id: string }>(
      "select id from workspace_roles where workspace_id = $1 and builtin_key = 'viewer'",
      [workspaceId],
    );
    const viewerRoleId = viewerRoleRes.rows[0]!.id;
    const viewerRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
       values (gen_random_uuid(), $1, $2, 'Viewer', 'human', 'active', $3) returning id`,
      [workspaceId, viewerUser, viewerRoleId],
    );
    viewerMemberId = viewerRes.rows[0]!.id;

    // Add custom zero role member (kpi = 0)
    const customRoleRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_roles (id, workspace_id, name, is_default)
       values (gen_random_uuid(), $1, 'Custom Zero W', false) returning id`,
      [workspaceId],
    );
    const customRoleId = customRoleRes.rows[0]!.id;
    await wb.admin.query(
      `insert into role_permissions (id, workspace_id, role_id, domain, level)
       values (gen_random_uuid(), $1, $2, 'kpi', 0)`,
      [workspaceId, customRoleId],
    );
    const zeroRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
       values (gen_random_uuid(), $1, $2, 'Zero', 'human', 'active', $3) returning id`,
      [workspaceId, zeroUser, customRoleId],
    );
    zeroMemberId = zeroRes.rows[0]!.id;

    // Add guest member
    const guestRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
       values (gen_random_uuid(), $1, $2, 'Guest', 'guest', 'active') returning id`,
      [workspaceId, guestUser],
    );
    guestMemberId = guestRes.rows[0]!.id;

    // Store user strings for context calls
    currentOwnerUser = ownerUser;
    currentViewerUser = viewerUser;
    currentZeroUser = zeroUser;
    currentGuestUser = guestUser;

    // Create KPI-A (unshared initially)
    const a = (await callAction(context(currentOwnerUser), "kpis.create", {
      title: "KPI-A",
      indicatorType: "leading",
      direction: "higher_better",
      frequency: "monthly",
      targetType: "at_least",
      targetDefault: 100,
      aggregate: "last",
      ownerKind: "workspace",
    })) as { id: string };
    kpiAId = a.id;

    // Create KPI-B (unshared)
    const b = (await callAction(context(currentOwnerUser), "kpis.create", {
      title: "KPI-B",
      indicatorType: "leading",
      direction: "higher_better",
      frequency: "monthly",
      targetType: "at_least",
      targetDefault: 100,
      aggregate: "last",
      ownerKind: "workspace",
    })) as { id: string };
    kpiBId = b.id;

    // Create KPI-C (hidden from viewer and zero)
    const c = (await callAction(context(currentOwnerUser), "kpis.create", {
      title: "KPI-C",
      indicatorType: "leading",
      direction: "higher_better",
      frequency: "monthly",
      targetType: "at_least",
      targetDefault: 100,
      aggregate: "last",
      ownerKind: "workspace",
    })) as { id: string };
    kpiCId = c.id;

    // Grant Viewer an edit share on KPI-A
    await withTx(async (tx) => {
      const ctxId = await ensureKpiContextInTx(tx, {
        workspaceId,
        kpiId: kpiAId,
      });
      const viewerGroup = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: viewerMemberId,
      });
      await bindGroup(tx, {
        workspaceId,
        groupId: viewerGroup,
        contextId: ctxId,
        level: ACCESS_LEVELS.edit,
        tag: "share",
      });
    });
  });

  it("AC-9: a Viewer with an edit share on KPI-A records reading on KPI-A; refused on KPI-B", async () => {
    // KPI-A succeeds
    const resA = (await callAction(context(currentViewerUser), "kpis.record", {
      kpiId: kpiAId,
      on: "2026-11-01",
      actualValue: 120,
    })) as { id: string; periodStart: string };
    expect(resA.id).toBeDefined();

    // KPI-B with no share is refused (forbidden)
    await expect(
      callAction(context(currentViewerUser), "kpis.record", {
        kpiId: kpiBId,
        on: "2026-11-01",
        actualValue: 50,
      }),
    ).rejects.toThrow(OperationError);
  });

  it("AC-10: a Viewer with edit share on KPI-A cannot deleteRecord or launchRecovery", async () => {
    // Record a reading on KPI-A
    const record = (await callAction(
      context(currentViewerUser),
      "kpis.record",
      {
        kpiId: kpiAId,
        on: "2026-11-01",
        actualValue: 40,
      },
    )) as { id: string };

    // deleteRecord requires role on kpi at edit (70), Viewer role has 10
    await expect(
      callAction(context(currentViewerUser), "kpis.deleteRecord", {
        id: record.id,
      }),
    ).rejects.toThrow(OperationError);

    const cycle = (await callAction(
      context(currentOwnerUser),
      "cycles.current",
      {
        mode: "quarterly",
      },
    )) as { id: string };

    // launchRecovery requires role on kpi at edit (70)
    await expect(
      callAction(context(currentViewerUser), "kpis.launchRecovery", {
        kpiId: kpiAId,
        cycleId: cycle.id,
      }),
    ).rejects.toThrow(OperationError);
  });

  it("AC-23: custom role with kpi at 0 can record reading with edit share, but cannot createTree or recordResponse", async () => {
    // Grant Zero member an edit share on KPI-A
    await withTx(async (tx) => {
      const ctxId = await ensureKpiContextInTx(tx, {
        workspaceId,
        kpiId: kpiAId,
      });
      const zeroGroup = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: zeroMemberId,
      });
      await bindGroup(tx, {
        workspaceId,
        groupId: zeroGroup,
        contextId: ctxId,
        level: ACCESS_LEVELS.edit,
        tag: "share",
      });
    });

    // Zero can record on KPI-A
    const resA = (await callAction(context(currentZeroUser), "kpis.record", {
      kpiId: kpiAId,
      on: "2026-11-01",
      actualValue: 90,
    })) as { id: string };
    expect(resA.id).toBeDefined();

    // Zero cannot create a tree (needs role edit)
    await expect(
      callAction(context(currentZeroUser), "kpis.createTree", {
        name: "Zero Tree",
      }),
    ).rejects.toThrow(OperationError);

    // Zero cannot recordResponse (needs role edit)
    await expect(
      callAction(context(currentZeroUser), "kpis.recordResponse", {
        kpiId: kpiAId,
        kind: "fix_now",
        taskId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(OperationError);
  });

  it("setFormula is refused when a referenced KPI is hidden from member", async () => {
    // Grant Guest an edit share on KPI-A
    await withTx(async (tx) => {
      const ctxId = await ensureKpiContextInTx(tx, {
        workspaceId,
        kpiId: kpiAId,
      });
      const guestGroup = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: guestMemberId,
      });
      await bindGroup(tx, {
        workspaceId,
        groupId: guestGroup,
        contextId: ctxId,
        level: ACCESS_LEVELS.edit,
        tag: "share",
      });
    });

    // KPI-C is unshared, so it is hidden from Guest.
    // Try to set formula on KPI-A that references KPI-C as Guest.
    const formula = {
      kind: "binary",
      operator: "add",
      left: { kind: "ref", kpiId: kpiCId },
      right: { kind: "constant", value: 10 },
    };

    await expect(
      callAction(context(currentGuestUser), "kpis.setFormula", {
        kpiId: kpiAId,
        formula,
        on: "2026-11-01",
      }),
    ).rejects.toThrow(OperationError);
  });

  it("update with a hidden parentKpiId throws not_found", async () => {
    // Grant Guest an edit share on KPI-A
    await withTx(async (tx) => {
      const ctxId = await ensureKpiContextInTx(tx, {
        workspaceId,
        kpiId: kpiAId,
      });
      const guestGroup = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: guestMemberId,
      });
      await bindGroup(tx, {
        workspaceId,
        groupId: guestGroup,
        contextId: ctxId,
        level: ACCESS_LEVELS.edit,
        tag: "share",
      });
    });

    // KPI-C is unshared, so it is hidden from Guest.
    // Guest tries to update KPI-A with parentKpiId = kpiCId
    await expect(
      callAction(context(currentGuestUser), "kpis.update", {
        kpiId: kpiAId,
        parentKpiId: kpiCId,
        read: {
          parentKpiId: null,
        },
      }),
    ).rejects.toThrow(OperationError);
  });
});
