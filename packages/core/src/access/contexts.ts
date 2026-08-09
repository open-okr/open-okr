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
  accessGroups,
  activeOnly,
  type WorkspaceTx,
} from "@openokr/db";
import { eq } from "drizzle-orm";
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
