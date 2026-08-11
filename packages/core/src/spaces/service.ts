/**
 * Space writes, as helpers an Operation's `execute` calls (TECHNICAL-PLAN
 * §4.2, §4.14, P3-T01).
 *
 * Two callers share every function here: the space actions, and workspace
 * provisioning, which creates the default space in the same transaction as the
 * workspace itself. Neither reimplements the wiring, so a space made by the
 * wizard and a space made by an admin are the same shape.
 *
 * **What a role means, in access terms.** A space owns one access context. Three
 * tiers reach it:
 *
 * | Principal | Level | Why |
 * |---|---|---|
 * | `workspace_standard` | view | Every human member can see a space exists and ask to join it. There is no space privacy concept: §4.14 names none, and without discovery "join and leave" means nothing |
 * | `space_standard` | edit | Being in the space is what lets you work in it |
 * | A manager's own `member` group | full | Administering the space: its name, its mission, who is in it |
 * | A coordinator's own `member` group | edit, tagged `coordinator` | The tag is the point, not the level. The nudge engine finds the person who runs the weekly session by tag rather than by re-querying a column |
 *
 * A coordinator therefore holds no more access than an ordinary member, which
 * is correct: running the session is a duty, not a permission.
 */
import {
  accessContexts,
  activeOnly,
  newId,
  type SpaceRole,
  spaceMembers,
  spaces,
  type WorkspaceTx,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import {
  addGroupMembership,
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureSpaceStandardGroup,
  ensureWorkspaceStandardGroup,
  removeGroupMembership,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface CreateSpaceInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly mission?: string | null;
  /** Given the `manager` role, and a `full` binding with it. */
  readonly managerMemberId?: string;
  /** Supplied by provisioning, which needs the id before the row exists. */
  readonly spaceId?: string;
}

export interface CreatedSpace {
  readonly id: string;
  readonly name: string;
  readonly mission: string | null;
  readonly contextId: string;
}

/**
 * The space, its access context, its standard group and its first manager,
 * written together.
 *
 * Called from inside an Operation's `execute`, on that Operation's
 * transaction, so the audit and activity rows commit with it.
 */
export async function createSpaceInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CreateSpaceInput): Promise<CreatedSpace> {
  const name = input.name.trim();
  // A plain Error, not an OperationError. Every caller either validates the
  // name at the boundary (the action's own Zod schema) or passes the
  // workspace's own name, so an empty one here is a bug rather than a refusal
  // to report to a member.
  if (name === "") {
    throw new Error("createSpaceInTx was called with an empty name.");
  }
  const spaceId = input.spaceId ?? newId();

  // openokr:allow-mutation: this helper runs on the transaction the calling
  // Operation opened, so the space, its access wiring and that Operation's
  // audit row commit together or not at all.
  const [row] = await tx
    .insert(spaces)
    .values({
      id: spaceId,
      workspaceId: input.workspaceId,
      name,
      mission: input.mission?.trim() || null,
    })
    .returning({ id: spaces.id, name: spaces.name, mission: spaces.mission });

  if (!row) {
    throw new Error("The space insert returned no row.");
  }

  const contextId = await ensureContext(tx, {
    workspaceId: input.workspaceId,
    resourceType: "space",
    resourceId: spaceId,
  });

  // Discovery. Without this every space would be invisible to anyone not
  // already in it, and nobody could ever join one.
  const workspaceStandardGroupId = await ensureWorkspaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: workspaceStandardGroupId,
    contextId,
    level: ACCESS_LEVELS.view,
  });

  // Participation. Membership of this group is data, so the binding here grants
  // nothing until somebody is actually put in it.
  const spaceStandardGroupId = await ensureSpaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
    spaceId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: spaceStandardGroupId,
    contextId,
    level: ACCESS_LEVELS.edit,
  });

  if (input.managerMemberId) {
    await addSpaceMemberInTx(tx, {
      workspaceId: input.workspaceId,
      spaceId,
      contextId,
      memberId: input.managerMemberId,
      role: "manager",
    });
  }

  return { id: row.id, name: row.name, mission: row.mission, contextId };
}

export interface AddSpaceMemberInput {
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly memberId: string;
  readonly role: SpaceRole;
  /** Resolved by the caller when it already has it, looked up otherwise. */
  readonly contextId?: string;
}

/**
 * Puts a member in a space, in a role, and grants exactly what that role
 * means.
 *
 * Idempotent on the membership row: a second call for the same person changes
 * their role rather than adding a second row, which is what the unique index in
 * migration 0019 enforces anyway.
 */
export async function addSpaceMemberInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: AddSpaceMemberInput): Promise<void> {
  const contextId =
    input.contextId ??
    (await resolveSpaceContextId(tx, input.workspaceId, input.spaceId));

  const [existing] = await tx
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      activeOnly(
        spaceMembers,
        eq(spaceMembers.workspaceId, input.workspaceId),
        eq(spaceMembers.spaceId, input.spaceId),
        eq(spaceMembers.memberId, input.memberId),
      ),
    )
    .limit(1);

  if (existing) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(spaceMembers)
      .set({ role: input.role, updatedAt: new Date() })
      .where(activeOnly(spaceMembers, eq(spaceMembers.id, existing.id)));
  } else {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(spaceMembers).values({
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      memberId: input.memberId,
      role: input.role,
    });
  }

  const spaceStandardGroupId = await ensureSpaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
  });
  await addGroupMembership(tx, {
    workspaceId: input.workspaceId,
    groupId: spaceStandardGroupId,
    memberId: input.memberId,
  });

  await applyRoleBindings(tx, {
    workspaceId: input.workspaceId,
    contextId,
    memberId: input.memberId,
    role: input.role,
  });
}

export interface RemoveSpaceMemberInput {
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly memberId: string;
  readonly contextId?: string;
}

/**
 * Takes a member out of a space, and takes back everything the space gave
 * them: the group membership, and any role binding their own group held on
 * this space's context.
 *
 * The `workspace_standard` view binding is untouched, so they can still see
 * the space exists and rejoin it. That is the point of a team home rather than
 * a locked room.
 */
export async function removeSpaceMemberInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: RemoveSpaceMemberInput): Promise<void> {
  const contextId =
    input.contextId ??
    (await resolveSpaceContextId(tx, input.workspaceId, input.spaceId));

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(spaceMembers)
    .set({ deletedAt: new Date() })
    .where(
      activeOnly(
        spaceMembers,
        eq(spaceMembers.workspaceId, input.workspaceId),
        eq(spaceMembers.spaceId, input.spaceId),
        eq(spaceMembers.memberId, input.memberId),
      ),
    );

  const spaceStandardGroupId = await ensureSpaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
  });
  await removeGroupMembership(tx, {
    workspaceId: input.workspaceId,
    groupId: spaceStandardGroupId,
    memberId: input.memberId,
  });

  const memberGroupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await unbindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: memberGroupId,
    contextId,
  });
}

interface ApplyRoleBindingsInput {
  readonly workspaceId: string;
  readonly contextId: string;
  readonly memberId: string;
  readonly role: SpaceRole;
}

/**
 * The role's own bindings, replaced rather than added to.
 *
 * Every role change clears whatever this member's own group held on the space
 * first. Adding without clearing would leave a demoted manager holding `full`
 * for ever, which is the shape of bug that only shows up when somebody uses it.
 */
async function applyRoleBindings<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ApplyRoleBindingsInput): Promise<void> {
  const memberGroupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });

  await unbindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: memberGroupId,
    contextId: input.contextId,
  });

  if (input.role === "manager") {
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: memberGroupId,
      contextId: input.contextId,
      level: ACCESS_LEVELS.full,
    });
    return;
  }

  if (input.role === "coordinator") {
    // `edit` is what space_standard already gives every member of the space.
    // The tag is the reason this binding exists: it is how a nudge finds the
    // person who runs the weekly session.
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: memberGroupId,
      contextId: input.contextId,
      level: ACCESS_LEVELS.edit,
      tag: "coordinator",
    });
  }
}

/**
 * The space's own access context id.
 *
 * This is not an authorisation check and never stands in for one. It resolves
 * an identifier the caller then authorises against, which every caller here
 * does through `getAccessScoped` before reaching a write.
 */
export async function resolveSpaceContextId<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, spaceId: string): Promise<string> {
  const [context] = await tx
    .select({ id: accessContexts.id })
    .from(accessContexts)
    .where(
      activeOnly(
        accessContexts,
        eq(accessContexts.workspaceId, workspaceId),
        eq(accessContexts.resourceType, "space"),
        eq(accessContexts.resourceId, spaceId),
      ),
    )
    .limit(1);

  if (!context) {
    throw new OperationError(
      "not_found",
      "No such space, or you do not have access to it.",
    );
  }
  return context.id;
}
