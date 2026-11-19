/**
 * Per-KPI access contexts and bindings (0.10.0 K2, docs/design/kpi-access.md).
 *
 * Every KPI owns an `access_contexts` row with resourceType "kpi".
 * The context holds:
 * - workspace_standard at view (10), untagged (KA-D2)
 * - owner's member group at full (100), tag "owner" (KA-D4)
 * - grantee shares with tag "share" at view (10) or edit (70) (KA-D6)
 * - Champion and Coach at view (10) when spaceless (KA-D9)
 */
import {
  accessContexts,
  activeOnly,
  kpis,
  type WorkspaceTx,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import {
  bindGroup,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/errors.ts";

export interface EnsureKpiContextInput {
  readonly workspaceId: string;
  readonly kpiId: string;
}

/**
 * Returns the live `kpi` context id, creating it when missing with the bindings
 * of §3.1. Insert uses `on conflict do nothing` on `access_contexts_resource_idx`,
 * then selects, so two concurrent callers end with one row.
 */
export async function ensureKpiContextInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: WorkspaceTx<TSchema>, input: EnsureKpiContextInput): Promise<string> {
  // openokr:allow-mutation: called inside an Operation's execute or getter.
  const [inserted] = await tx
    .insert(accessContexts)
    .values({
      workspaceId: input.workspaceId,
      resourceType: "kpi",
      resourceId: input.kpiId,
    })
    .onConflictDoNothing({
      target: [
        accessContexts.workspaceId,
        accessContexts.resourceType,
        accessContexts.resourceId,
      ],
      where: isNull(accessContexts.deletedAt),
    })
    .returning({ id: accessContexts.id });

  const contextId: string | undefined = inserted?.id;
  if (!contextId) {
    const [existing] = await tx
      .select({ id: accessContexts.id })
      .from(accessContexts)
      .where(
        activeOnly(
          accessContexts,
          eq(accessContexts.workspaceId, input.workspaceId),
          eq(accessContexts.resourceType, "kpi"),
          eq(accessContexts.resourceId, input.kpiId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new OperationError("not_found", "No such KPI context.");
    }
    return existing.id;
  }

  // Initial bindings (§3.1):
  // 1. workspace_standard at view (10), untagged
  const stdGroupId = await ensureWorkspaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: stdGroupId,
    contextId,
    level: ACCESS_LEVELS.view,
  });

  // 2. Owner's member group at full (100), tagged "owner" (if KPI has an owner)
  const [kpi] = await tx
    .select({ ownerMemberId: kpis.ownerMemberId })
    .from(kpis)
    .where(
      activeOnly(
        kpis,
        eq(kpis.workspaceId, input.workspaceId),
        eq(kpis.id, input.kpiId),
      ),
    )
    .limit(1);

  if (kpi?.ownerMemberId) {
    const ownerGroupId = await ensureMemberGroup(tx, {
      workspaceId: input.workspaceId,
      memberId: kpi.ownerMemberId,
    });
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: ownerGroupId,
      contextId,
      level: ACCESS_LEVELS.full,
      tag: "owner",
    });
  }

  return contextId;
}

export interface RebindKpiOwnerInput {
  readonly workspaceId: string;
  readonly contextId: string;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * Rebinds owner on a KPI context (0.10.0 K2, §5).
 * unbindGroup with tag owner for from; bindGroup at 100 with tag owner for to.
 */
export async function rebindKpiOwnerInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: WorkspaceTx<TSchema>, input: RebindKpiOwnerInput): Promise<void> {
  if (input.from === input.to) {
    return;
  }
  if (input.from) {
    const fromGroupId = await ensureMemberGroup(tx, {
      workspaceId: input.workspaceId,
      memberId: input.from,
    });
    await unbindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: fromGroupId,
      contextId: input.contextId,
      tag: "owner",
    });
  }
  if (input.to) {
    const toGroupId = await ensureMemberGroup(tx, {
      workspaceId: input.workspaceId,
      memberId: input.to,
    });
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: toGroupId,
      contextId: input.contextId,
      level: ACCESS_LEVELS.full,
      tag: "owner",
    });
  }
}
