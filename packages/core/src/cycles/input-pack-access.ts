/**
 * Who may change a cycle's input pack (docs/design/input-pack-access.md, plan
 * 0.9.0 G8).
 *
 * The pack is the seven items and the distribution date on phase 1. Before
 * this, every active member held `edit` on the workspace context for
 * self-service, so every member could tick items and confirm distribution.
 * The direction is narrower: the Owner, the Admins and the cycle's named
 * facilitator.
 *
 * **One function for the write and the screen.** `workflow.setPackItem` and
 * `workflow.distributePack` refuse through it, and `workflow.read` answers the
 * screen through it, so the page never draws a control the write would
 * refuse, and never hides one it would accept.
 *
 * **Why not a `domain` on the actions.** The rule is "the workspace write
 * floor (R1) OR the facilitator". A domain alone can only say the first half
 * and would refuse a facilitator who is a Member.
 */

import { activeOnly, cycles, workspaceMembers } from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveMemberRoleLevel } from "../access/reads.ts";
import {
  type ActorInput,
  type OperationTx,
  writeFloorFor,
} from "../operations/operation.ts";

/**
 * The sentence a refused write carries. Kept here, beside the rule, so the
 * two actions cannot word it differently.
 */
export const INPUT_PACK_REFUSAL =
  "Only an Owner, an Admin or this cycle's facilitator can change the input pack.";

export interface InputPackAccess {
  readonly canChange: boolean;
  /**
   * The facilitator who may change the pack, or null when nobody named holds
   * the right: no facilitator, a suspended or removed one, or one whose role
   * is below Member. The screen words its "who may change this" line from it.
   */
  readonly facilitatorName: string | null;
}

/**
 * Whether a member's role is Member or above.
 *
 * **How "Member or above" is compared.** The seeded Member and Viewer roles
 * grant the same level on the `workspace` domain (`view`), so that domain
 * cannot tell them apart. `comment` is where the seeded ladder first rises
 * above Viewer: Viewer holds `view` there, Member holds `comment`, Admin and
 * Owner `full`. A role passes when it grants at least `comment` on the
 * `comment` domain. That reads "more than read only" and follows the role the
 * workspace actually has, edited or custom, rather than a role's name. A
 * member with no role (a guest, an agent, a placeholder) comes back null and
 * fails.
 */
async function isMemberOrAbove(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
): Promise<boolean> {
  const level = await resolveMemberRoleLevel(tx, {
    workspaceId,
    memberId,
    domain: "comment",
  });
  return level !== null && level >= ACCESS_LEVELS.comment;
}

/** The cycle's facilitator when that member may hold the right, else null. */
async function qualifyingFacilitator(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
): Promise<{ id: string; name: string; userId: string | null } | null> {
  const [row] = await tx
    .select({
      id: workspaceMembers.id,
      name: workspaceMembers.name,
      userId: workspaceMembers.userId,
    })
    .from(cycles)
    .innerJoin(workspaceMembers, eq(workspaceMembers.id, cycles.facilitatorId))
    .where(
      and(
        activeOnly(
          cycles,
          eq(cycles.id, cycleId),
          eq(cycles.workspaceId, workspaceId),
        ),
        // A suspended, removed or non-human facilitator holds nothing (D2).
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.status, "active"),
          eq(workspaceMembers.kind, "human"),
        ),
      ),
    )
    .limit(1);
  if (!row || !(await isMemberOrAbove(tx, workspaceId, row.id))) {
    return null;
  }
  return row;
}

export async function inputPackAccess(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly actor: ActorInput;
    readonly cycleId: string;
  },
): Promise<InputPackAccess> {
  const facilitator = await qualifyingFacilitator(
    tx,
    input.workspaceId,
    input.cycleId,
  );
  const facilitatorName = facilitator?.name ?? null;

  // R1's floor first: the Owner and Admins pass by role, and a system actor
  // by its own `full`.
  const floor = await writeFloorFor(tx, {
    workspaceId: input.workspaceId,
    actor: input.actor,
    domain: "workspace",
  });
  if (floor >= ACCESS_LEVELS.edit) {
    return { canChange: true, facilitatorName };
  }

  // Then the facilitator, by name. Only a human can be one, so an agent
  // never reaches here with a match (D6).
  const { actor } = input;
  const isFacilitator =
    facilitator !== null &&
    actor.kind === "human" &&
    ((actor.memberId !== undefined && actor.memberId === facilitator.id) ||
      (actor.userId !== undefined && actor.userId === facilitator.userId));
  return { canChange: isFacilitator, facilitatorName };
}

/** The write's check: whether this actor may change this cycle's pack. */
export async function mayChangeInputPack(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly actor: ActorInput;
    readonly cycleId: string;
  },
): Promise<boolean> {
  return (await inputPackAccess(tx, input)).canChange;
}
