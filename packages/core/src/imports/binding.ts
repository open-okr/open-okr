/**
 * The one binding an import needs to finish what it started (P6-T04a).
 *
 * **The access model has no ambient admin authority, and that is right.** A
 * goal binds `workspace_standard` at view, its owning space at edit, and its
 * champion and reviewer by role. A space binds its own members. A task binds
 * the space it sits in. In the product, whoever creates one of these is
 * normally one of those people, so nothing binds the creator as such.
 *
 * An import is the case where they are none of them. It writes a space whose
 * manager has never signed in, an objective championed by somebody else, and
 * an initiative owned by a third person, and then cannot add the key results,
 * the tasks or the checklist lines that belong to them. Every one of those
 * refusals is the access model working correctly on a shape it was not written
 * for.
 *
 * **So a create that carries a legacy key binds its actor, at edit.** Three
 * properties make that a narrow fix rather than a hole:
 *
 *  - only a create carrying a legacy key does it, which means only an import;
 *  - `edit` and not `full`, so the migrator can add and change but not delete;
 *  - it is an ordinary binding row, visible in the access tables and removable
 *    like any other.
 *
 * The alternative was widening `requireGoalAccess`, `requireSpaceAdmin` and
 * `requireTask` so that any workspace admin reaches any row, which is a much
 * larger grant, made permanently, for one command's benefit.
 *
 * Called from `goals.create`, `spaces.create`, `initiatives.create` and
 * `tasks.create`. Written once here so the reasoning lives in one place rather
 * than four.
 */
import type { WorkspaceTx } from "@openokr/db";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";

export interface BindImporterInput {
  readonly workspaceId: string;
  /** The member the run acts as. Absent for a bootstrap operation. */
  readonly memberId: string | null | undefined;
  readonly contextId: string;
  /**
   * A member already bound to this context by the create itself.
   *
   * A space whose leader did not import falls back to the actor as its
   * manager, and `createSpaceInTx` has already bound their group at full.
   * Binding it again violates the untagged-binding unique index.
   */
  readonly alreadyBound?: string | null | undefined;
}

export async function bindImporterInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: WorkspaceTx<TSchema>, input: BindImporterInput): Promise<void> {
  if (!input.memberId || input.alreadyBound === input.memberId) {
    return;
  }
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: ACCESS_LEVELS.edit,
  });
}
