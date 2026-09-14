/**
 * The tenant lifecycle, and how it reaches the freeze overlay (P8-T02c).
 *
 * Design: `docs/design/p8-t01a-tenant-lifecycle.md` §3.
 *
 * **The lifecycle adds no second enforcement point.** `workspaces.state` and
 * the P2-T09 freeze overlay already refuse every write outside the recovery
 * list, before the actor is even resolved. So a transition here writes both
 * rows in the caller's one transaction and then gets out of the way. Nothing
 * anywhere reads `tenants.state` to decide whether a write is allowed.
 *
 * `freeze.ts` left the `read_only` versus `frozen` difference "to whichever
 * task actually needs that difference". This is that task, and the answer is
 * that the difference is not in the permission layer at all: both refuse the
 * same writes, and what separates them is the sentence the member reads and
 * whether the retention clock is running.
 */

import type { TenantState } from "@openokr/db";
import {
  activeOnly,
  tenants,
  type withWorkspace,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";

/** The drizzle transaction handed to a `withWorkspace` callback. */
type AnyTx = Parameters<Parameters<typeof withWorkspace>[2]>[0];

/**
 * What each tenant state means for the workspace the freeze overlay reads.
 *
 * A table rather than a switch, because it is the whole of the mapping and a
 * reader should be able to see all three at once.
 */
const WORKSPACE_STATE: Record<TenantState, "active" | "read_only" | "frozen"> =
  {
    active: "active",
    suspended: "read_only",
    closed: "frozen",
  };

export interface SetTenantStateInput {
  readonly workspaceId: string;
  readonly state: TenantState;
  /** Injected so a test can close a workspace in the past. */
  readonly now?: Date;
}

/**
 * Moves a tenant between active, suspended and closed.
 *
 * Runs on the caller's transaction, so the tenant row, the workspace row and
 * the Operation's own audit and activity rows commit together. A workspace
 * that was suspended but whose tenant row said otherwise would be a state
 * nobody could explain afterwards.
 *
 * Returns false when there is no tenant row, which is every self-hosted
 * instance. The caller decides what that means; on a self-hosted instance
 * there is no lifecycle to move and `workspace.setState` is the whole of what
 * freezing means.
 */
export async function setTenantStateInTx(
  tx: AnyTx,
  input: SetTenantStateInput,
): Promise<boolean> {
  const now = input.now ?? new Date();

  // openokr:allow-mutation: this helper writes on the transaction its caller
  // already opened, which is the closing action's own Operation. The same
  // arrangement `seedTenantInTx` and `createSpaceInTx` use.
  const [updated] = await tx
    .update(tenants)
    .set({
      state: input.state,
      // The check constraint in migration 0082 ties these two together in
      // both directions, so a closed tenant always has an instant for the
      // retention sweep to read and an open one never does. Setting it here
      // rather than in a trigger keeps the rule visible to a reader.
      closedAt: input.state === "closed" ? now : null,
      updatedAt: now,
    })
    .where(activeOnly(tenants, eq(tenants.workspaceId, input.workspaceId)))
    .returning({ workspaceId: tenants.workspaceId });

  if (!updated) {
    return false;
  }

  // openokr:allow-mutation: same transaction, same reason. This is the write
  // the freeze overlay actually reads.
  await tx
    .update(workspaces)
    .set({ state: WORKSPACE_STATE[input.state], updatedAt: now })
    .where(activeOnly(workspaces, eq(workspaces.id, input.workspaceId)));

  return true;
}
