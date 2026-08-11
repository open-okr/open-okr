/**
 * Access-model writes for use inside an Operation's `execute` (TECHNICAL-PLAN
 * §4.1). Every protected aggregate is born with its context and default
 * bindings in the same transaction as the change that creates it; these are
 * the primitives that transaction calls. `can()` and the getter that read
 * these tables back are P2-T02.
 */
import {
  type AccessRoleTag,
  accessBindings,
  accessContexts,
  accessGroupMemberships,
  accessGroups,
  activeOnly,
  type WorkspaceTx,
} from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import type { AccessLevel } from "./levels.ts";

/**
 * Generic over the transaction's schema type, so this accepts both the
 * Operation pipeline's transaction and the plain `drizzle(pool)` transaction
 * provisioning opens before the Operation lift reaches it. Structurally the
 * same transaction; only the schema type parameter TypeScript infers differs
 * by call site.
 */
type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface EnsureContextInput {
  readonly workspaceId: string;
  readonly resourceType: string;
  readonly resourceId: string;
}

/** Gives a resource its access context. One call, one row, one resource. */
export async function ensureContext<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: EnsureContextInput): Promise<string> {
  // openokr:allow-mutation: this helper is called only from inside an
  // Operation's execute, on the transaction that Operation opened, so the
  // insert commits with that Operation's activity and audit rows.
  const [row] = await tx
    .insert(accessContexts)
    .values(input)
    .returning({ id: accessContexts.id });
  return (row as { id: string }).id;
}

export interface EnsureWorkspaceStandardGroupInput {
  readonly workspaceId: string;
}

/**
 * The workspace's one `workspace_standard` group: every active member
 * belongs to it by definition, so nothing enumerates who is "in" it.
 * Idempotent, so any Operation may call it without checking first.
 */
export async function ensureWorkspaceStandardGroup<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: EnsureWorkspaceStandardGroupInput,
): Promise<string> {
  const [existing] = await tx
    .select({ id: accessGroups.id })
    .from(accessGroups)
    .where(
      activeOnly(
        accessGroups,
        eq(accessGroups.workspaceId, input.workspaceId),
        eq(accessGroups.kind, "workspace_standard"),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }
  // openokr:allow-mutation: same reason as ensureContext above.
  const [row] = await tx
    .insert(accessGroups)
    .values({ workspaceId: input.workspaceId, kind: "workspace_standard" })
    .returning({ id: accessGroups.id });
  return (row as { id: string }).id;
}

export interface EnsureMemberGroupInput {
  readonly workspaceId: string;
  readonly memberId: string;
}

/**
 * A member's own `member` group: the principal a binding names to grant that
 * one person access directly, without a role tag or a wider tier. Idempotent.
 */
export async function ensureMemberGroup<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: EnsureMemberGroupInput): Promise<string> {
  const [existing] = await tx
    .select({ id: accessGroups.id })
    .from(accessGroups)
    .where(
      activeOnly(
        accessGroups,
        eq(accessGroups.workspaceId, input.workspaceId),
        eq(accessGroups.kind, "member"),
        eq(accessGroups.memberId, input.memberId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }
  // openokr:allow-mutation: same reason as ensureContext above.
  const [row] = await tx
    .insert(accessGroups)
    .values({
      workspaceId: input.workspaceId,
      kind: "member",
      memberId: input.memberId,
    })
    .returning({ id: accessGroups.id });
  return (row as { id: string }).id;
}

export interface EnsureSpaceStandardGroupInput {
  readonly workspaceId: string;
  readonly spaceId: string;
}

/**
 * A space's one `space_standard` group (P3-T01). Unlike
 * `workspace_standard`, membership of this group is real data: an
 * `access_group_memberships` row per person, which is what
 * `resolveMemberAccessLevel` checks before letting the tier reach them.
 * Idempotent, and the unique index in migration 0019 is what makes it safe
 * under two concurrent callers rather than only under one.
 */
export async function ensureSpaceStandardGroup<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: EnsureSpaceStandardGroupInput): Promise<string> {
  const [existing] = await tx
    .select({ id: accessGroups.id })
    .from(accessGroups)
    .where(
      activeOnly(
        accessGroups,
        eq(accessGroups.workspaceId, input.workspaceId),
        eq(accessGroups.kind, "space_standard"),
        eq(accessGroups.spaceId, input.spaceId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }
  // openokr:allow-mutation: same reason as ensureContext above.
  const [row] = await tx
    .insert(accessGroups)
    .values({
      workspaceId: input.workspaceId,
      kind: "space_standard",
      spaceId: input.spaceId,
    })
    .returning({ id: accessGroups.id });
  return (row as { id: string }).id;
}

export interface GroupMembershipInput {
  readonly workspaceId: string;
  readonly groupId: string;
  readonly memberId: string;
}

/**
 * Puts a member in a group whose membership is data (P3-T01). Idempotent: a
 * second call for the same pair returns the existing row rather than adding a
 * duplicate, so joining a space twice is a no-op instead of an error.
 */
export async function addGroupMembership<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: GroupMembershipInput): Promise<string> {
  const [existing] = await tx
    .select({ id: accessGroupMemberships.id })
    .from(accessGroupMemberships)
    .where(
      activeOnly(
        accessGroupMemberships,
        eq(accessGroupMemberships.workspaceId, input.workspaceId),
        eq(accessGroupMemberships.groupId, input.groupId),
        eq(accessGroupMemberships.memberId, input.memberId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }
  // openokr:allow-mutation: same reason as ensureContext above.
  const [row] = await tx
    .insert(accessGroupMemberships)
    .values({
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      memberId: input.memberId,
    })
    .returning({ id: accessGroupMemberships.id });
  return (row as { id: string }).id;
}

/**
 * Takes a member out of a group. Soft delete, so the fact that they were once
 * in it survives for the feed and the audit trail, and
 * `resolveMemberAccessLevel` stops finding them immediately because every tier
 * it walks is filtered on `deleted_at is null`.
 */
export async function removeGroupMembership<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: GroupMembershipInput): Promise<void> {
  // openokr:allow-mutation: same reason as ensureContext above.
  await tx
    .update(accessGroupMemberships)
    .set({ deletedAt: sql`now()` })
    .where(
      activeOnly(
        accessGroupMemberships,
        eq(accessGroupMemberships.workspaceId, input.workspaceId),
        eq(accessGroupMemberships.groupId, input.groupId),
        eq(accessGroupMemberships.memberId, input.memberId),
      ),
    );
}

export interface BindGroupInput {
  readonly workspaceId: string;
  readonly groupId: string;
  readonly contextId: string;
  readonly level: AccessLevel;
  readonly tag?: AccessRoleTag;
}

/** The grant itself: a group holding a level on a context. */
export async function bindGroup<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: BindGroupInput): Promise<string> {
  // openokr:allow-mutation: same reason as ensureContext above.
  const [row] = await tx
    .insert(accessBindings)
    .values({
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      contextId: input.contextId,
      level: input.level,
      tag: input.tag ?? null,
    })
    .returning({ id: accessBindings.id });
  return (row as { id: string }).id;
}

export interface UnbindGroupInput {
  readonly workspaceId: string;
  readonly groupId: string;
  readonly contextId: string;
  /** Narrows to bindings carrying this role tag. Omit for every binding. */
  readonly tag?: AccessRoleTag;
}

/**
 * Revokes a grant (P3-T01). Soft delete, for the same reason as
 * `removeGroupMembership`: the level stops resolving at once, and the history
 * of who held what survives.
 *
 * Used when a space role changes. A demoted manager loses the `full` binding
 * their own member group held on the space, and keeps whatever
 * `space_standard` gives every member of it.
 */
export async function unbindGroup<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: UnbindGroupInput): Promise<void> {
  // openokr:allow-mutation: same reason as ensureContext above.
  await tx
    .update(accessBindings)
    .set({ deletedAt: sql`now()` })
    .where(
      activeOnly(
        accessBindings,
        eq(accessBindings.workspaceId, input.workspaceId),
        eq(accessBindings.groupId, input.groupId),
        eq(accessBindings.contextId, input.contextId),
        input.tag === undefined ? undefined : eq(accessBindings.tag, input.tag),
      ),
    );
}
