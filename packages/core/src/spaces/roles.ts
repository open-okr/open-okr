/**
 * Who covers which duty in a space (TECHNICAL-PLAN §4.2, METHOD.md §2.5).
 *
 * Pure functions over a loaded member list. The rule they encode is one
 * sentence in §4.2 and easy to get wrong in three places at once: "a manager
 * covers the coordinator's duties while no coordinator is named, and any nudge
 * or escalation targeting a coordinator falls back to the manager".
 *
 * Resolved on read rather than stored. Writing a second `coordinator` row for
 * a manager would mean remembering to remove it the moment a real coordinator
 * is named, and the one-coordinator-per-space index would refuse it anyway.
 */
import type { SpaceRole } from "@openokr/db";

export interface SpaceRoleHolder {
  readonly memberId: string;
  readonly role: SpaceRole;
}

/**
 * The member who runs this space's weekly session: the named coordinator, or
 * the first manager while there is none, or nobody.
 *
 * "First manager" is by the order the caller loaded them, which every caller
 * here orders by `created_at`. The longest-standing manager is a defensible
 * answer and an arbitrary one is not.
 */
export function resolveCoordinator(
  members: readonly SpaceRoleHolder[],
): string | undefined {
  const coordinator = members.find((member) => member.role === "coordinator");
  if (coordinator) {
    return coordinator.memberId;
  }
  return members.find((member) => member.role === "manager")?.memberId;
}

/** Every manager of the space, in load order. */
export function resolveManagers(
  members: readonly SpaceRoleHolder[],
): readonly string[] {
  return members
    .filter((member) => member.role === "manager")
    .map((member) => member.memberId);
}

/**
 * Whether this space still has somebody who can administer it after the
 * proposed change.
 *
 * A space with no manager is not broken in the way a workspace with no admin
 * is: a workspace admin can always appoint one. So this reports rather than
 * refuses, and the caller decides. `spaces.leave` uses it to refuse the one
 * case that would strand a space with members and no manager at all.
 */
export function wouldStrandSpace(
  members: readonly SpaceRoleHolder[],
  leavingMemberId: string,
): boolean {
  const remaining = members.filter(
    (member) => member.memberId !== leavingMemberId,
  );
  if (remaining.length === 0) {
    // An empty space needs no manager. A workspace admin can still reach it,
    // because admin access does not come from space membership.
    return false;
  }
  return resolveManagers(remaining).length === 0;
}
