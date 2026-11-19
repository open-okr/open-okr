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
  accessBindings,
  accessContexts,
  activeOnly,
  kpis,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  bindGroup,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import {
  accessFilterMember,
  resolveMemberAccessLevel,
  resolveMemberRoleLevel,
  visibleResourceIds,
} from "../access/reads.ts";
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

export interface RequireKpiAccessInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly kpiId: string;
  readonly requires?: AccessLevel;
}

/**
 * Throws not_found for a missing or deleted KPI and for a level below requires.
 * With a context: level on own context via resolveMemberAccessLevel.
 * Straggler: §4 rule using resolveMemberRoleLevel and accessFilterMember.
 */
export async function requireKpiAccess<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  input: RequireKpiAccessInput,
): Promise<{ contextId: string | null; level: number }> {
  const [kpi] = await tx
    .select({ id: kpis.id })
    .from(kpis)
    .where(
      activeOnly(
        kpis,
        eq(kpis.workspaceId, input.workspaceId),
        eq(kpis.id, input.kpiId),
      ),
    )
    .limit(1);

  if (!kpi) {
    throw new OperationError(
      "not_found",
      "No such KPI, or you do not have access to it.",
    );
  }

  const requires = input.requires ?? ACCESS_LEVELS.view;

  const [context] = await tx
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

  if (context) {
    const level = await resolveMemberAccessLevel(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      contextId: context.id,
    });
    if (level < requires) {
      throw new OperationError(
        "not_found",
        "No such KPI, or you do not have access to it.",
      );
    }
    return { contextId: context.id, level };
  }

  // Straggler: §4 rule using resolveMemberRoleLevel and accessFilterMember
  const member = await accessFilterMember(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  if (!member.active || !member.human) {
    throw new OperationError(
      "not_found",
      "No such KPI, or you do not have access to it.",
    );
  }

  const roleLevel = await resolveMemberRoleLevel(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    domain: "kpi",
  });

  let effectiveLevel = Math.max(roleLevel ?? 0, ACCESS_LEVELS.view);
  if (member.supportLevel !== undefined) {
    effectiveLevel = Math.min(effectiveLevel, member.supportLevel);
  }

  if (effectiveLevel < requires) {
    throw new OperationError(
      "not_found",
      "No such KPI, or you do not have access to it.",
    );
  }

  return { contextId: null, level: effectiveLevel };
}

export interface VisibleKpiIdsInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly ids: readonly string[];
  readonly requires?: AccessLevel;
}

/**
 * The subset of KPI ids the member may see, in at most two statements (0.10.0 K4, §5).
 * Statement 1: visibleResourceIds for KPIs with context.
 * Statement 2: stragglers among ids that pass the §4 rule.
 */
export async function visibleKpiIds<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: WorkspaceTx<TSchema>, input: VisibleKpiIdsInput): Promise<Set<string>> {
  if (input.ids.length === 0) {
    return new Set();
  }

  const requires = input.requires ?? ACCESS_LEVELS.view;

  // Statement 1: visible contextual KPIs
  const visible = await visibleResourceIds(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    resourceType: "kpi",
    ids: input.ids,
    requires,
  });

  // Statement 2: stragglers among input.ids that pass the §4 rule
  const stragglers = await tx.execute<{ id: string }>(sql`
    with actor as (
      select kind, role_id,
             (select s.level from operator_sessions s
               where s.member_id = workspace_members.id
                 and s.granted_at is not null
                 and s.ended_at is null
                 and s.expires_at > now()
                 and s.deleted_at is null
               limit 1) as support_level
        from workspace_members
       where id = ${input.memberId}
         and workspace_id = ${input.workspaceId}
         and status = 'active'
         and deleted_at is null
         and not exists (
           select 1 from operator_sessions s
            where s.member_id = workspace_members.id
              and s.ended_at is null
              and s.deleted_at is null
              and s.expires_at is not null
              and s.expires_at <= now()
         )
    ),
    role_level as (
      select coalesce(max(rp.level), 0)::int as level
        from role_permissions rp
       where rp.workspace_id = ${input.workspaceId}
         and rp.deleted_at is null
         and rp.domain = 'kpi'
         and exists (
           select 1 from actor
            where (actor.kind = 'human' or actor.support_level is not null)
              and actor.role_id is not null
              and actor.role_id = rp.role_id
         )
    )
    select k.id
      from kpis k
     where k.workspace_id = ${input.workspaceId}
       and k.deleted_at is null
       and k.id = any(${sql.param([...input.ids])}::uuid[])
       and not exists (
         select 1 from access_contexts c
          where c.workspace_id = ${input.workspaceId}
            and c.resource_type = 'kpi'
            and c.resource_id = k.id
            and c.deleted_at is null
       )
       and exists (
         select 1 from actor
          where (actor.kind = 'human' or actor.support_level is not null)
            and least(
              greatest(
                (select level from role_level),
                ${ACCESS_LEVELS.view}
              ),
              coalesce(actor.support_level, ${ACCESS_LEVELS.full})
            ) >= ${requires}
       )
  `);

  for (const row of stragglers.rows) {
    visible.add(row.id);
  }

  return visible;
}

export interface RequireKpiRoleInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly requires: AccessLevel;
}

/**
 * Requires the member's workspace role on domain "kpi" to be at least `requires` (0.10.0 K5, §5).
 * Throws `forbidden` when roleLevel < requires. For the actions of KA-D17.
 */
export async function requireKpiRole<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: WorkspaceTx<TSchema>, input: RequireKpiRoleInput): Promise<void> {
  const roleLevel = await resolveMemberRoleLevel(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    domain: "kpi",
  });

  if (roleLevel === null || roleLevel < input.requires) {
    throw new OperationError(
      "forbidden",
      "Your role does not grant enough access on KPIs.",
    );
  }
}

export interface SetKpiShareInput {
  readonly workspaceId: string;
  readonly contextId: string;
  readonly memberId: string;
  readonly level: AccessLevel;
}

/**
 * Sets an individual KPI share (0.10.0 K6, §5).
 * Ensures member group, then inserts or updates the live `share` binding to exactly `level`.
 * Lowering level is allowed for the `share` tag (KA-D6).
 */
export async function setKpiShareInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  input: SetKpiShareInput,
): Promise<{ previous: AccessLevel | null }> {
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });

  const [held] = await tx
    .select({ id: accessBindings.id, level: accessBindings.level })
    .from(accessBindings)
    .where(
      activeOnly(
        accessBindings,
        eq(accessBindings.workspaceId, input.workspaceId),
        eq(accessBindings.groupId, groupId),
        eq(accessBindings.contextId, input.contextId),
        eq(accessBindings.tag, "share"),
      ),
    )
    .limit(1);

  if (held) {
    const previous = held.level as AccessLevel;
    if (held.level !== input.level) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(accessBindings)
        .set({ level: input.level })
        .where(activeOnly(accessBindings, eq(accessBindings.id, held.id)));
    }
    return { previous };
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(accessBindings).values({
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: input.level,
    tag: "share",
  });
  return { previous: null };
}

export interface RemoveKpiShareInput {
  readonly workspaceId: string;
  readonly contextId: string;
  readonly memberId: string;
}

/**
 * Removes an individual KPI share (0.10.0 K6, §5).
 * Soft-deletes the `share` binding tagged 'share'.
 * Returns previous level (or null) and whether a binding was removed.
 */
export async function removeKpiShareInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  input: RemoveKpiShareInput,
): Promise<{ previous: AccessLevel | null; removed: boolean }> {
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });

  const [held] = await tx
    .select({ id: accessBindings.id, level: accessBindings.level })
    .from(accessBindings)
    .where(
      activeOnly(
        accessBindings,
        eq(accessBindings.workspaceId, input.workspaceId),
        eq(accessBindings.groupId, groupId),
        eq(accessBindings.contextId, input.contextId),
        eq(accessBindings.tag, "share"),
      ),
    )
    .limit(1);

  if (held) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(accessBindings)
      .set({ deletedAt: sql`now()` })
      .where(activeOnly(accessBindings, eq(accessBindings.id, held.id)));
    return { previous: held.level as AccessLevel, removed: true };
  }

  return { previous: null, removed: false };
}

/**
 * Resolves the role-level for the 'kpi' domain and editable KPI ids for a member,
 * under the tenant floor (withWorkspace).
 */
export async function resolveKpiGridAccess(
  pool: Pool,
  workspaceId: string,
  memberId: string,
  kpiIds: readonly string[],
): Promise<{
  readonly canEdit: boolean;
  readonly editableKpiIds?: ReadonlySet<string>;
}> {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, async (tx) => {
    const roleLevel = await resolveMemberRoleLevel(tx, {
      workspaceId,
      memberId,
      domain: "kpi",
    });
    // If no role assigned, fall back to true (member edit)
    const canEdit = (roleLevel ?? ACCESS_LEVELS.edit) >= ACCESS_LEVELS.edit;
    if (canEdit || kpiIds.length === 0) {
      return { canEdit };
    }
    const editable = await visibleKpiIds(tx, {
      workspaceId,
      memberId,
      ids: kpiIds,
      requires: ACCESS_LEVELS.edit,
    });
    return { canEdit: false, editableKpiIds: editable };
  });
}
