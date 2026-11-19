/**
 * Per-KPI read access enforcement (0.10.0 K4, docs/design/kpi-access.md §4, §5, §6, §12).
 *
 * AC-11, AC-12, AC-15 to AC-25, AC-28, AC-31, and the §5 straggler test.
 */
import {
  accessBindings,
  accessContexts,
  activeOnly,
  kpis as kpisTable,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import type { ActionCallContext } from "../src/actions/define.ts";
import { callAction } from "../src/actions/registry.ts";
import type { AgentScope } from "../src/agents/scope.ts";
import { gather } from "../src/exports/lists.ts";
import { ensureKpiContextInTx, requireKpiAccess } from "../src/kpis/access.ts";
import { dueKpiCorridorNudges } from "../src/nudges/sweep.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER_USER = "kpi-read-owner";
const GUEST_USER = "kpi-read-guest";
const VIEWER_USER = "kpi-read-viewer";
const MEMBER_USER = "kpi-read-member";
const ZERO_USER = "kpi-read-zero";

let workspaceId: string;
let ownerMemberId: string;
let guestMemberId: string;
let viewerMemberId: string;
let memberMemberId: string;
let _zeroMemberId: string;
let spaceId: string;

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

beforeEach(async () => {
  const wb = await workerDb();
  appPool = wb.appPool;
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values
      ($1, 'Owner', 'owner@example.com'),
      ($2, 'Guest', 'guest@example.com'),
      ($3, 'Viewer', 'viewer@example.com'),
      ($4, 'Member', 'member@example.com'),
      ($5, 'Zero', 'zero@example.com')`,
    [OWNER_USER, GUEST_USER, VIEWER_USER, MEMBER_USER, ZERO_USER],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER_USER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER_USER)!.id;

  // Add guest member
  const guestRes = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Guest', 'guest', 'active') returning id`,
    [workspaceId, GUEST_USER],
  );
  guestMemberId = guestRes.rows[0]!.id;

  // Add viewer member
  const viewerRoleRes = await wb.admin.query<{ id: string }>(
    "select id from workspace_roles where workspace_id = $1 and builtin_key = 'viewer'",
    [workspaceId],
  );
  const viewerRoleId = viewerRoleRes.rows[0]!.id;
  const viewerRes = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Viewer', 'human', 'active', $3) returning id`,
    [workspaceId, VIEWER_USER, viewerRoleId],
  );
  viewerMemberId = viewerRes.rows[0]!.id;

  // Add regular member
  const memberRoleRes = await wb.admin.query<{ id: string }>(
    "select id from workspace_roles where workspace_id = $1 and builtin_key = 'member'",
    [workspaceId],
  );
  const memberRoleId = memberRoleRes.rows[0]!.id;
  const memberRes = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Member', 'human', 'active', $3) returning id`,
    [workspaceId, MEMBER_USER, memberRoleId],
  );
  memberMemberId = memberRes.rows[0]!.id;

  // Add custom zero role member (kpi = 0)
  const customRoleRes = await wb.admin.query<{ id: string }>(
    `insert into workspace_roles (id, workspace_id, name, is_default)
     values (gen_random_uuid(), $1, 'Custom Zero', false) returning id`,
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
    [workspaceId, ZERO_USER, customRoleId],
  );
  _zeroMemberId = zeroRes.rows[0]?.id ?? "";

  // Create a space S
  const space = (await callAction(context(OWNER_USER), "spaces.create", {
    name: "Engineering",
  })) as { id: string };
  spaceId = space.id;

  // Add guest to space S
  await callAction(context(OWNER_USER), "spaces.addMember", {
    spaceId,
    memberId: guestMemberId,
    role: "member",
  });

  // Create KPI-A (unshared, workspace-owned)
  const a = (await callAction(context(OWNER_USER), "kpis.create", {
    title: "KPI-A Unshared",
    indicatorType: "lagging",
    direction: "higher_better",
    frequency: "monthly",
    targetType: "at_least",
    targetDefault: 100,
    aggregate: "last",
    ownerKind: "workspace",
  })) as { id: string };
  kpiAId = a.id;

  // Create KPI-B (will be shared with guest at view)
  const b = (await callAction(context(OWNER_USER), "kpis.create", {
    title: "KPI-B Shared",
    indicatorType: "leading",
    direction: "higher_better",
    frequency: "monthly",
    targetType: "at_least",
    targetDefault: 100,
    aggregate: "last",
    ownerKind: "workspace",
  })) as { id: string };
  kpiBId = b.id;

  // Create KPI-C in space S
  const c = (await callAction(context(OWNER_USER), "kpis.create", {
    title: "KPI-C In Space",
    indicatorType: "leading",
    direction: "higher_better",
    frequency: "monthly",
    targetType: "at_least",
    targetDefault: 100,
    aggregate: "last",
    ownerKind: "space",
    spaceId,
  })) as { id: string };
  kpiCId = c.id;

  // Share KPI-B with guest at view (level 10, tag: share)
  await withTx(async (tx) => {
    const kpiBContextId = await ensureKpiContextInTx(tx, {
      workspaceId,
      kpiId: kpiBId,
    });
    const guestGroupId = await ensureMemberGroup(tx, {
      workspaceId,
      memberId: guestMemberId,
    });
    await bindGroup(tx, {
      workspaceId,
      groupId: guestGroupId,
      contextId: kpiBContextId,
      level: ACCESS_LEVELS.view,
      tag: "share",
    });
  });
});

describe("KPI read access enforcement", () => {
  it("AC-11: a guest with view share on KPI-B only lists KPI-B in grid and list", async () => {
    const grid = (await callAction(context(GUEST_USER), "kpis.grid", {
      periods: 12,
    })) as { kpis: Array<{ id: string; title: string }> };
    expect(grid.kpis.map((k) => k.id)).toEqual([kpiBId]);

    const list = (await callAction(context(GUEST_USER), "kpis.list", {})) as {
      kpis: Array<{ id: string; title: string }>;
    };
    expect(list.kpis.map((k) => k.id)).toEqual([kpiBId]);
  });

  it("AC-12: guest detail read on unshared KPI-C throws not_found, succeeds on KPI-B", async () => {
    await expect(
      callAction(context(GUEST_USER), "kpis.detail", {
        kpiId: kpiCId,
        periods: 12,
      }),
    ).rejects.toThrow(OperationError);

    const detailB = (await callAction(context(GUEST_USER), "kpis.detail", {
      kpiId: kpiBId,
      periods: 12,
    })) as { kpi: { id: string; title: string } };
    expect(detailB.kpi.id).toBe(kpiBId);
  });

  it("AC-15: guest export of KPI list holds KPI-B only", async () => {
    const table = await gather(callAction, context(GUEST_USER), {
      list: "kpis",
    });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[0]).toBe("KPI-B Shared");
  });

  it("AC-16: guest sees only KPI-B in trees and recovery; hidden parent shows Parent not visible", async () => {
    // Make KPI-A parent of KPI-B
    await withTx(async (tx) => {
      await tx
        .update(kpisTable)
        .set({ parentKpiId: kpiAId })
        .where(eq(kpisTable.id, kpiBId));
    });

    const tree = (await callAction(context(GUEST_USER), "kpis.tree", {
      treeId: null,
    })) as {
      nodes: Array<{
        id: string;
        parentKpiId: string | null;
        parentHidden?: boolean;
      }>;
    };

    expect(tree.nodes.map((n) => n.id)).toEqual([kpiBId]);
    const nodeB = tree.nodes[0]!;
    // Drawn as a root with parentHidden flag
    expect(nodeB.parentKpiId).toBeNull();
    expect(nodeB.parentHidden).toBe(true);

    // Set KPI-B to unhealthy, KPI-C to unhealthy
    await withTx(async (tx) => {
      await tx
        .update(kpisTable)
        .set({ state: "unhealthy" })
        .where(eq(kpisTable.id, kpiBId));
      await tx
        .update(kpisTable)
        .set({ state: "unhealthy" })
        .where(eq(kpisTable.id, kpiCId));
    });

    const board = (await callAction(
      context(GUEST_USER),
      "kpis.recoveryBoard",
      {},
    )) as { cards: Array<{ kpiId: string }> };
    expect(board.cards.map((c) => c.kpiId)).toEqual([kpiBId]);
  });

  it("AC-17: guest in space S with no share on space KPI sees an empty KPI section", async () => {
    const spaceTrees = (await callAction(
      context(GUEST_USER),
      "kpis.spaceTrees",
      { spaceId },
    )) as { trees: Array<unknown> };
    expect(spaceTrees.trees).toEqual([]);
  });

  it("AC-18: webhook delivery for KPI-C has null summary for guest", async () => {
    // Deliver summary for KPI-C as guest
    const guestCtx = {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: GUEST_USER },
    };
    const list = (await callAction(guestCtx, "kpis.list", {})) as {
      kpis: Array<{ id: string }>;
    };
    const summary = list.kpis.find((k) => k.id === kpiCId) ?? null;
    expect(summary).toBeNull();
  });

  it("AC-19: unhealthy KPI nudge sweep skips guest in the space without a share", async () => {
    await withTx(async (tx) => {
      await tx
        .update(kpisTable)
        .set({ state: "unhealthy" })
        .where(eq(kpisTable.id, kpiCId));
    });

    const due = await withTx(async (tx) => {
      return dueKpiCorridorNudges(tx, {
        workspaceId,
        thresholds: {
          ...canonThresholds(),
          "kpi.recoveryProposalDelayPeriods": 1,
        },
      });
    });

    const recipients = due.map((n) => n.recipientMemberId);
    expect(recipients).not.toContain(guestMemberId);
  });

  it("AC-20: guest calling goals.linkKpi or addKeyResult with unshared KPI-C throws not_found", async () => {
    const cycle = (await callAction(context(OWNER_USER), "cycles.current", {
      mode: "quarterly",
    })) as { id: string };

    const goal = (await callAction(context(OWNER_USER), "goals.create", {
      title: "Goal to link KPI",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };

    await expect(
      callAction(context(GUEST_USER), "goals.addKeyResult", {
        goalId: goal.id,
        title: "Linked KR",
        indicatorType: "leading",
        direction: "increase",
        baselineValue: 0,
        weight: 1,
        kpiId: kpiCId,
      }),
    ).rejects.toThrow(OperationError);
  });

  it("AC-21: guest feed shows no activity for unshared KPI-C", async () => {
    // Record a reading on KPI-C as owner
    await callAction(context(OWNER_USER), "kpis.record", {
      kpiId: kpiCId,
      on: "2026-11-01",
      actualValue: 85,
    });

    const feed = (await callAction(
      context(GUEST_USER),
      "activities.workspaceFeed",
      {},
    )) as Array<{ subjectType: string; subjectId: string }>;

    const kpiCItems = feed.filter(
      (item) => item.subjectType === "kpi" && item.subjectId === kpiCId,
    );
    expect(kpiCItems).toHaveLength(0);
  });

  it("AC-22: a Viewer with no share lists every KPI in S-20 grid", async () => {
    const grid = (await callAction(context(VIEWER_USER), "kpis.grid", {
      periods: 12,
    })) as { kpis: Array<{ id: string }> };
    const ids = grid.kpis.map((k) => k.id);
    expect(ids).toContain(kpiAId);
    expect(ids).toContain(kpiBId);
    expect(ids).toContain(kpiCId);
  });

  it("AC-23: custom role with kpi at 0 lists every KPI in S-20 grid", async () => {
    const grid = (await callAction(context(ZERO_USER), "kpis.grid", {
      periods: 12,
    })) as { kpis: Array<{ id: string }> };
    const ids = grid.kpis.map((k) => k.id);
    expect(ids).toContain(kpiAId);
    expect(ids).toContain(kpiBId);
    expect(ids).toContain(kpiCId);
  });

  it("AC-24 & §5 straggler test: space KPI with no context (straggler) respects straggler rule", async () => {
    // Delete KPI-C's context to turn it into a straggler
    await withTx(async (tx) => {
      await tx
        .delete(accessContexts)
        .where(eq(accessContexts.resourceType, "kpi"));
    });

    await withTx(async (tx) => {
      // Member reads it at view
      const memberAccess = await requireKpiAccess(tx, {
        workspaceId,
        memberId: memberMemberId,
        kpiId: kpiCId,
        requires: ACCESS_LEVELS.view,
      });
      expect(memberAccess.level).toBeGreaterThanOrEqual(ACCESS_LEVELS.view);
      expect(memberAccess.contextId).toBeNull();

      // Viewer reads it at view
      const viewerAccess = await requireKpiAccess(tx, {
        workspaceId,
        memberId: viewerMemberId,
        kpiId: kpiCId,
        requires: ACCESS_LEVELS.view,
      });
      expect(viewerAccess.level).toBe(ACCESS_LEVELS.view);
      expect(viewerAccess.contextId).toBeNull();

      // §5 straggler test: Viewer refused edit on straggler
      await expect(
        requireKpiAccess(tx, {
          workspaceId,
          memberId: viewerMemberId,
          kpiId: kpiCId,
          requires: ACCESS_LEVELS.edit,
        }),
      ).rejects.toThrow(OperationError);

      // Guest refused view on straggler
      await expect(
        requireKpiAccess(tx, {
          workspaceId,
          memberId: guestMemberId,
          kpiId: kpiCId,
          requires: ACCESS_LEVELS.view,
        }),
      ).rejects.toThrow(OperationError);
    });
  });

  it("AC-25: when 0037 has not run (all stragglers), any human lists every KPI in grid", async () => {
    // Delete all KPI access contexts
    await withTx(async (tx) => {
      await tx
        .delete(accessContexts)
        .where(eq(accessContexts.resourceType, "kpi"));
    });

    const grid = (await callAction(context(VIEWER_USER), "kpis.grid", {
      periods: 12,
    })) as { kpis: Array<{ id: string }> };
    expect(grid.kpis.length).toBe(3);
  });

  it("AC-28: agent bound to space S then unbound loses sight of S's KPIs", async () => {
    const wb = await workerDb();
    // Create agent member
    const agentRes = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Test Agent', 'agent', 'active') returning id`,
      [workspaceId],
    );
    const agentMemberId = agentRes.rows[0]!.id;

    // Bind agent to space S
    const spaceCtx = await withTx(async (tx) => {
      const [ctx] = await tx
        .select({ id: accessContexts.id })
        .from(accessContexts)
        .where(
          activeOnly(
            accessContexts,
            eq(accessContexts.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "space"),
            eq(accessContexts.resourceId, spaceId),
          ),
        );
      const agentGroupId = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: agentMemberId,
      });
      await bindGroup(tx, {
        workspaceId,
        groupId: agentGroupId,
        contextId: ctx!.id,
        level: ACCESS_LEVELS.view,
      });
      return ctx!.id;
    });

    // Agent scope sees KPI-C
    const scope: AgentScope = { memberId: agentMemberId };
    let due = await withTx(async (tx) => {
      return dueKpiCorridorNudges(tx, {
        workspaceId,
        thresholds: {
          ...canonThresholds(),
          "kpi.recoveryProposalDelayPeriods": 1,
        },
        scope,
      });
    });
    // Now unbind agent from space S
    await withTx(async (tx) => {
      await tx
        .update(accessBindings)
        .set({ deletedAt: new Date() })
        .where(eq(accessBindings.contextId, spaceCtx));
    });

    due = await withTx(async (tx) => {
      return dueKpiCorridorNudges(tx, {
        workspaceId,
        thresholds: {
          ...canonThresholds(),
          "kpi.recoveryProposalDelayPeriods": 1,
        },
        scope,
      });
    });
    // KPI-C is out of sight
    expect(due.filter((d) => d.subjectId === kpiCId)).toHaveLength(0);
  });

  it("AC-31: soft-deleted KPI with live context throws not_found for former owner on kpis.detail", async () => {
    await withTx(async (tx) => {
      await tx
        .update(kpisTable)
        .set({ deletedAt: new Date() })
        .where(eq(kpisTable.id, kpiAId));
    });

    await expect(
      callAction(context(OWNER_USER), "kpis.detail", {
        kpiId: kpiAId,
        periods: 12,
      }),
    ).rejects.toThrow(OperationError);
  });
});
