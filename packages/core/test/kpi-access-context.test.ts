import {
  accessBindings,
  accessContexts,
  accessGroups,
  activeOnly,
  kpis as kpisTable,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { kpiContextResolver } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { ensureKpiContextInTx } from "../src/kpis/access.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "kpi-ctx-owner";
const SECOND = "kpi-ctx-second";
const THIRD = "kpi-ctx-third";

let workspaceId: string;
let ownerMemberId: string;
let secondMemberId: string;
let thirdMemberId: string;
let wsContextId: string;

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
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)",
    [
      OWNER,
      "KPI Owner",
      "kpi-owner@example.com",
      SECOND,
      "KPI Second",
      "kpi-second@example.com",
      THIRD,
      "KPI Third",
      "kpi-third@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "KPI Owner",
  });
  workspaceId = provisioned.workspaceId;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;

  // Second member: active Member
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'KPI Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;

  // Third member: active Member, to be assigned viewer
  const third = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'KPI Third', 'active') returning id`,
    [workspaceId, THIRD],
  );
  thirdMemberId = third.rows[0]?.id as string;

  // Assign roles
  const { roles } = await callAction(
    { pool: wb.appPool, ...context() },
    "roles.list",
    {},
  );
  const memberRole = roles.find((r) => r.builtinKey === "member");
  const viewerRole = roles.find((r) => r.builtinKey === "viewer");

  await callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
    memberId: secondMemberId,
    roleId: memberRole?.id as string,
  });
  await callAction({ pool: wb.appPool, ...context() }, "roles.assign", {
    memberId: thirdMemberId,
    roleId: viewerRole?.id as string,
  });

  // Get workspace context id
  const wsCtx = await wb.admin.query<{ id: string }>(
    "select id from access_contexts where workspace_id = $1 and resource_type = 'workspace'",
    [workspaceId],
  );
  wsContextId = wsCtx.rows[0]?.id as string;
});

async function createKpi(overrides: Record<string, unknown> = {}) {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
    title: "Test KPI",
    frequency: "monthly",
    ownerMemberId,
    ...overrides,
  } as never) as Promise<{ id: string }>;
}

describe("KPI access contexts (0.10.0 K2)", () => {
  it("create binds workspace_standard at 10, the owner at 100 tag owner, and Champion and Coach only when space_id is null", async () => {
    const wb = await workerDb();

    // 1. Spaceless KPI
    const spaceless = await createKpi({
      title: "Spaceless KPI",
    });

    const [spacelessContext] = await withTx((tx) =>
      tx
        .select()
        .from(accessContexts)
        .where(
          activeOnly(
            accessContexts,
            eq(accessContexts.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, spaceless.id),
          ),
        ),
    );
    expect(spacelessContext).toBeDefined();

    const spacelessBindings = await withTx((tx) =>
      tx
        .select({
          level: accessBindings.level,
          tag: accessBindings.tag,
          groupKind: accessGroups.kind,
          memberId: accessGroups.memberId,
        })
        .from(accessBindings)
        .innerJoin(accessGroups, eq(accessBindings.groupId, accessGroups.id))
        .where(
          activeOnly(
            accessBindings,
            eq(accessBindings.workspaceId, workspaceId),
            eq(accessBindings.contextId, spacelessContext?.id as string),
          ),
        ),
    );

    // workspace_standard at 10, untagged
    expect(
      spacelessBindings.some(
        (b) =>
          b.groupKind === "workspace_standard" &&
          b.level === ACCESS_LEVELS.view &&
          b.tag === null,
      ),
    ).toBe(true);

    // owner at 100, tag "owner"
    expect(
      spacelessBindings.some(
        (b) =>
          b.memberId === ownerMemberId &&
          b.level === ACCESS_LEVELS.full &&
          b.tag === "owner",
      ),
    ).toBe(true);

    // agents (Champion and Coach) bound at view (10) for spaceless
    const agentMembers = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and kind = 'agent'",
      [workspaceId],
    );
    const agentMemberIds = new Set(agentMembers.rows.map((r) => r.id));
    const spacelessAgentBindings = spacelessBindings.filter(
      (b) => b.memberId && agentMemberIds.has(b.memberId),
    );
    expect(spacelessAgentBindings.length).toBeGreaterThanOrEqual(1);

    // 2. Space KPI
    const space = (await callAction(
      { pool: wb.appPool, ...context() },
      "spaces.create",
      { name: "Product Space" },
    )) as { id: string };

    const spaceKpi = await createKpi({
      title: "Space KPI",
      ownerKind: "space",
      spaceId: space.id,
    });

    const [spaceKpiContext] = await withTx((tx) =>
      tx
        .select()
        .from(accessContexts)
        .where(
          activeOnly(
            accessContexts,
            eq(accessContexts.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, spaceKpi.id),
          ),
        ),
    );
    expect(spaceKpiContext).toBeDefined();

    const spaceBindings = await withTx((tx) =>
      tx
        .select({
          level: accessBindings.level,
          tag: accessBindings.tag,
          groupKind: accessGroups.kind,
          memberId: accessGroups.memberId,
        })
        .from(accessBindings)
        .innerJoin(accessGroups, eq(accessBindings.groupId, accessGroups.id))
        .where(
          activeOnly(
            accessBindings,
            eq(accessBindings.workspaceId, workspaceId),
            eq(accessBindings.contextId, spaceKpiContext?.id as string),
          ),
        ),
    );

    // workspace_standard at 10, untagged
    expect(
      spaceBindings.some(
        (b) =>
          b.groupKind === "workspace_standard" &&
          b.level === ACCESS_LEVELS.view &&
          b.tag === null,
      ),
    ).toBe(true);

    // owner at 100, tag "owner"
    expect(
      spaceBindings.some(
        (b) =>
          b.memberId === ownerMemberId &&
          b.level === ACCESS_LEVELS.full &&
          b.tag === "owner",
      ),
    ).toBe(true);

    // NO agent bindings on space KPI
    const spaceAgentBindings = spaceBindings.filter(
      (b) => b.memberId && agentMemberIds.has(b.memberId),
    );
    expect(spaceAgentBindings).toHaveLength(0);
  });

  it("AC-2: Member who does not own KPI and holds edit cannot change owner", async () => {
    const wb = await workerDb();
    const kpi = await createKpi({
      title: "AC-2 KPI",
    });

    // Member SECOND attempts to change owner to themselves
    await expect(
      callAction({ pool: wb.appPool, ...context(SECOND) }, "kpis.update", {
        kpiId: kpi.id,
        ownerMemberId: secondMemberId,
        read: {
          title: "AC-2 KPI",
          unit: null,
          targetDefault: null,
          parentKpiId: null,
          treeId: null,
          categoryId: null,
          indicatorType: "lagging",
          tier: null,
          ownerMemberId,
          healthyPct: null,
          watchPct: null,
          direction: "higher_better",
          targetType: "numerical",
          greenLow: null,
          greenHigh: null,
          redLow: null,
          redHigh: null,
        },
      }),
    ).rejects.toThrowError(OperationError);

    // Verify owner in DB is still ownerMemberId
    const [row] = await withTx((tx) =>
      tx
        .select({ ownerMemberId: kpisTable.ownerMemberId })
        .from(kpisTable)
        .where(
          activeOnly(
            kpisTable,
            eq(kpisTable.workspaceId, workspaceId),
            eq(kpisTable.id, kpi.id),
          ),
        ),
    );
    expect(row?.ownerMemberId).toBe(ownerMemberId);
  });

  it("AC-3: Viewer holding edit share on KPI cannot change owner", async () => {
    const wb = await workerDb();
    const kpi = await createKpi({
      title: "AC-3 KPI",
    });

    // Give Viewer THIRD an edit share (tag: "share", level: 70) on KPI context
    await withTx(async (tx) => {
      const [ctx] = await tx
        .select({ id: accessContexts.id })
        .from(accessContexts)
        .where(
          activeOnly(
            accessContexts,
            eq(accessContexts.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, kpi.id),
          ),
        );
      const [thirdGroup] = await tx
        .select({ id: accessGroups.id })
        .from(accessGroups)
        .where(
          activeOnly(
            accessGroups,
            eq(accessGroups.workspaceId, workspaceId),
            eq(accessGroups.kind, "member"),
            eq(accessGroups.memberId, thirdMemberId),
          ),
        );
      let groupId = thirdGroup?.id;
      if (!groupId) {
        const [inserted] = await tx
          .insert(accessGroups)
          .values({
            workspaceId,
            kind: "member",
            memberId: thirdMemberId,
          })
          .returning({ id: accessGroups.id });
        groupId = inserted?.id as string;
      }
      await tx.insert(accessBindings).values({
        workspaceId,
        groupId,
        contextId: ctx?.id as string,
        level: ACCESS_LEVELS.edit,
        tag: "share",
      });
    });

    // Viewer THIRD calls kpis.update to change owner
    await expect(
      callAction({ pool: wb.appPool, ...context(THIRD) }, "kpis.update", {
        kpiId: kpi.id,
        ownerMemberId: thirdMemberId,
        read: {
          title: "AC-3 KPI",
          unit: null,
          targetDefault: null,
          parentKpiId: null,
          treeId: null,
          categoryId: null,
          indicatorType: "lagging",
          tier: null,
          ownerMemberId,
          healthyPct: null,
          watchPct: null,
          direction: "higher_better",
          targetType: "numerical",
          greenLow: null,
          greenHigh: null,
          redLow: null,
          redHigh: null,
        },
      }),
    ).rejects.toThrowError(OperationError);
  });

  it("resolver returns workspace context for straggler and undefined for deleted KPI", async () => {
    const wb = await workerDb();

    // 1. Create a straggler: KPI row without access_contexts row
    const stragglerId = crypto.randomUUID();
    await wb.admin.query(
      `insert into kpis (id, workspace_id, short_id, title, frequency, direction, target_type, indicator_type, aggregate, owner_kind, state)
       values ($1, $2, 'kpi-straggler', 'Straggler KPI', 'monthly', 'higher_better', 'at_least', 'lagging', 'sum', 'workspace', 'no_data')`,
      [stragglerId, workspaceId],
    );

    const stragglerRes = await withTx((tx) =>
      kpiContextResolver(tx, stragglerId, workspaceId),
    );
    expect(stragglerRes).toEqual({ contextId: wsContextId });

    // 2. Soft-delete the straggler
    await wb.admin.query("update kpis set deleted_at = now() where id = $1", [
      stragglerId,
    ]);
    const deletedRes = await withTx((tx) =>
      kpiContextResolver(tx, stragglerId, workspaceId),
    );
    expect(deletedRes).toBeUndefined();

    // 3. Unknown KPI
    const unknownRes = await withTx((tx) =>
      kpiContextResolver(tx, crypto.randomUUID(), workspaceId),
    );
    expect(unknownRes).toBeUndefined();
  });

  it("two concurrent ensureKpiContextInTx calls leave one context", async () => {
    const wb = await workerDb();
    const kpiId = crypto.randomUUID();
    await wb.admin.query(
      `insert into kpis (id, workspace_id, short_id, title, frequency, direction, target_type, indicator_type, aggregate, owner_kind, state)
       values ($1, $2, 'kpi-concurrent', 'Concurrent KPI', 'monthly', 'higher_better', 'at_least', 'lagging', 'sum', 'workspace', 'no_data')`,
      [kpiId, workspaceId],
    );

    const [ctx1, ctx2] = await withTx((tx) =>
      Promise.all([
        ensureKpiContextInTx(tx, { workspaceId, kpiId }),
        ensureKpiContextInTx(tx, { workspaceId, kpiId }),
      ]),
    );

    expect(ctx1).toBe(ctx2);

    const contexts = await withTx((tx) =>
      tx
        .select()
        .from(accessContexts)
        .where(
          activeOnly(
            accessContexts,
            eq(accessContexts.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, kpiId),
          ),
        ),
    );
    expect(contexts).toHaveLength(1);
  });

  it("owner change to null removes the owner binding only", async () => {
    const wb = await workerDb();
    const kpi = await createKpi({
      title: "Owner Change KPI",
    });

    const [ctx] = await withTx((tx) =>
      tx
        .select({ id: accessContexts.id })
        .from(accessContexts)
        .where(
          activeOnly(
            accessContexts,
            eq(accessContexts.workspaceId, workspaceId),
            eq(accessContexts.resourceType, "kpi"),
            eq(accessContexts.resourceId, kpi.id),
          ),
        ),
    );
    const contextId = ctx?.id as string;

    // Add a share binding for SECOND on this context
    await withTx(async (tx) => {
      const secondGroup = await tx
        .select({ id: accessGroups.id })
        .from(accessGroups)
        .where(
          activeOnly(
            accessGroups,
            eq(accessGroups.workspaceId, workspaceId),
            eq(accessGroups.kind, "member"),
            eq(accessGroups.memberId, secondMemberId),
          ),
        );
      let groupId = secondGroup[0]?.id;
      if (!groupId) {
        const [inserted] = await tx
          .insert(accessGroups)
          .values({
            workspaceId,
            kind: "member",
            memberId: secondMemberId,
          })
          .returning({ id: accessGroups.id });
        groupId = inserted?.id as string;
      }
      await tx.insert(accessBindings).values({
        workspaceId,
        groupId,
        contextId,
        level: ACCESS_LEVELS.view,
        tag: "share",
      });
    });

    // Change owner to null as OWNER
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "kpis.update", {
      kpiId: kpi.id,
      ownerMemberId: null,
      read: {
        title: "Owner Change KPI",
        unit: null,
        targetDefault: null,
        parentKpiId: null,
        treeId: null,
        categoryId: null,
        indicatorType: "lagging",
        tier: null,
        ownerMemberId,
        healthyPct: null,
        watchPct: null,
        direction: "higher_better",
        targetType: "numerical",
        greenLow: null,
        greenHigh: null,
        redLow: null,
        redHigh: null,
      },
    });

    // Verify owner in DB is null
    const [updatedKpi] = await withTx((tx) =>
      tx
        .select({ ownerMemberId: kpisTable.ownerMemberId })
        .from(kpisTable)
        .where(
          activeOnly(
            kpisTable,
            eq(kpisTable.workspaceId, workspaceId),
            eq(kpisTable.id, kpi.id),
          ),
        ),
    );
    expect(updatedKpi?.ownerMemberId).toBeNull();

    // Verify owner binding is soft-deleted
    const allBindings = await withTx((tx) =>
      tx
        .select({
          tag: accessBindings.tag,
          deletedAt: accessBindings.deletedAt,
        })
        .from(accessBindings)
        .where(
          and(
            eq(accessBindings.workspaceId, workspaceId),
            eq(accessBindings.contextId, contextId),
          ),
        ),
    );

    const ownerBinding = allBindings.find((b) => b.tag === "owner");
    expect(ownerBinding).toBeDefined();
    expect(ownerBinding?.deletedAt).not.toBeNull();

    const shareBinding = allBindings.find((b) => b.tag === "share");
    expect(shareBinding).toBeDefined();
    expect(shareBinding?.deletedAt).toBeNull();

    const wsStdBinding = allBindings.find((b) => b.tag === null);
    expect(wsStdBinding).toBeDefined();
    expect(wsStdBinding?.deletedAt).toBeNull();
  });
});
