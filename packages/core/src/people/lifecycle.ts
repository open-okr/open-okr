/**
 * The member lifecycle: suspend, restore, guest conversion and erasure
 * (TECHNICAL-PLAN §4.1, P2-T03).
 *
 * **What "owner" means here.** Nothing in the schema names an owner role;
 * access is graded levels on a context, not named roles. The last-owner
 * invariant the test plan asks for is read against the workspace's own
 * context: an "owner" is any active member whose resolved level there is
 * `full`. Removing the last such member would leave nobody able to manage
 * the workspace at all, which is the state this guards against. Flagged in
 * STATUS.md as a reading a human should confirm.
 *
 * **Suspension already removes access.** `resolveMemberAccessLevel` and
 * `resolveActor` both exclude a non-`active` member, so suspending is enough
 * on its own; nothing here needs to touch a binding to take access away.
 * Restoring is the same in reverse.
 */
import {
  accessBindings,
  accessGroupMemberships,
  accessGroups,
  activeOnly,
  softDeleteRows,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq, inArray } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { OperationError } from "../operations/errors.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/**
 * Is `memberId` the only active member holding `full` on the workspace's own
 * context? Loads every active member and checks each one's level rather than
 * counting bindings directly, because a member can reach `full` through more
 * than one tier (§4.1) and only the resolved maximum answers the question.
 */
export async function isLastFullAccessHolder<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, memberId: string): Promise<boolean> {
  const context = await resolveSubjectContext(
    tx,
    "workspace",
    workspaceId,
    workspaceId,
  );
  if (!context) {
    // No context at all is not this member's problem to be blocked by.
    return false;
  }

  const others = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    );

  for (const other of others) {
    if (other.id === memberId) {
      continue;
    }
    const level = await resolveMemberAccessLevel(tx, {
      workspaceId,
      memberId: other.id,
      contextId: context.contextId,
    });
    if (level >= ACCESS_LEVELS.full) {
      return false;
    }
  }
  return true;
}

const LAST_OWNER_MESSAGE =
  "This is the only member with full access to the workspace. Give someone " +
  "else full access first.";

export function refuseIfLastOwner(isLast: boolean): void {
  if (isLast) {
    throw new OperationError("forbidden", LAST_OWNER_MESSAGE);
  }
}

/**
 * Removes every live binding held through `memberId`'s own `member` group,
 * and every live enrolment they hold in a `space_standard` group. Used by
 * guest conversion: the member keeps their own group, empty, so a future
 * binding still has somewhere to attach.
 */
export async function stripBindings<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, memberId: string): Promise<void> {
  const ownGroups = await tx
    .select({ id: accessGroups.id })
    .from(accessGroups)
    .where(
      activeOnly(
        accessGroups,
        eq(accessGroups.workspaceId, workspaceId),
        eq(accessGroups.kind, "member"),
        eq(accessGroups.memberId, memberId),
      ),
    );
  const groupIds = ownGroups.map((g) => g.id);
  if (groupIds.length > 0) {
    await softDeleteRows(
      tx,
      accessBindings,
      inArray(accessBindings.groupId, groupIds),
    );
  }
  await softDeleteRows(
    tx,
    accessGroupMemberships,
    eq(accessGroupMemberships.memberId, memberId),
  );
}

export interface ErasureExport {
  readonly memberId: string;
  readonly erasedAt: string;
  readonly priorProfile: {
    readonly name: string;
    readonly title: string | null;
    readonly bio: unknown;
    readonly timezone: string | null;
  };
}
