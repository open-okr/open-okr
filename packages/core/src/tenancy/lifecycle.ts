/**
 * The tenant lifecycle, and how it reaches the freeze overlay (P8-T02c).
 *
 * Design: `docs/design/tenant-lifecycle.md` §3.
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
  billingAccounts,
  tenants,
  withWorkspace,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { OperationError } from "../operations/errors.ts";

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
  /**
   * The owner closed it while it was active, so may reopen it. Ignored for any
   * other move, which always clears it (docs/design/workspace-erasure.md §3).
   */
  readonly ownerMayReopen?: boolean;
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

  // Once erasure has claimed it, nothing moves it: not an operator, not billing.
  const [claimed] = await tx
    .select({ erasingAt: tenants.erasingAt })
    .from(tenants)
    .where(activeOnly(tenants, eq(tenants.workspaceId, input.workspaceId)))
    .limit(1);
  if (claimed?.erasingAt) {
    throw new OperationError("not_found", "No such workspace.");
  }

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
      ownerMayReopen: input.state === "closed" && input.ownerMayReopen === true,
      // A new closure is reminded afresh (workspace-erasure.md §12, decision 3).
      erasureRemindedAt: null,
      suspendedByTrial: false, // the sweep sets it after its own move (§11 T7)
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

export interface TenantLifecycle {
  readonly state: TenantState;
  readonly closedAt: Date | null;
  /** The owner closed it while it was active, so may reopen it. */
  readonly ownerMayReopen: boolean;
  /** True when billing, not an operator, made it read-only. */
  readonly suspendedByBilling: boolean;
  /**
   * True when the trial sweep made it read-only, because its people do not
   * fit the plan its trial ended on (tenant-lifecycle.md §11 T7, T8).
   */
  readonly suspendedByTrial: boolean;
  /** When a running trial ends, for the last week's notice (§11 T10). */
  readonly trialEndsAt: Date | null;
}

/**
 * Where a workspace stands with its provider, or null with no tenant record, which
 * is every self-hosted instance.
 *
 * Read by the workspace's own actions, which may not see `tenants` themselves.
 */
export async function readLifecycleInTx(
  tx: AnyTx,
  workspaceId: string,
): Promise<TenantLifecycle | null> {
  const [tenant] = await tx
    .select({
      state: tenants.state,
      closedAt: tenants.closedAt,
      ownerMayReopen: tenants.ownerMayReopen,
      suspendedByTrial: tenants.suspendedByTrial,
      trialEndsAt: tenants.trialEndsAt,
    })
    .from(tenants)
    .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
    .limit(1);
  if (!tenant) {
    return null;
  }
  const [account] = await tx
    .select({ suspendedByBilling: billingAccounts.suspendedByBilling })
    .from(billingAccounts)
    .where(
      activeOnly(billingAccounts, eq(billingAccounts.workspaceId, workspaceId)),
    )
    .limit(1);
  return {
    state: tenant.state,
    closedAt: tenant.closedAt,
    ownerMayReopen: tenant.ownerMayReopen,
    suspendedByBilling: account?.suspendedByBilling ?? false,
    suspendedByTrial: tenant.suspendedByTrial,
    trialEndsAt: tenant.trialEndsAt,
  };
}

/** The same, for a screen: Admin, General and the banner on every page. */
export function readWorkspaceLifecycle(
  pool: Pool,
  workspaceId: string,
): Promise<TenantLifecycle | null> {
  return withWorkspace(drizzle(pool), workspaceId, (tx) =>
    readLifecycleInTx(tx, workspaceId),
  );
}

/**
 * Why a workspace's own administrator may not make this move, or null when they
 * may (docs/design/workspace-erasure.md §3).
 *
 * **Suspending, and lifting a suspension, are the provider's.** An operator's
 * suspension may be a legal hold, and billing's is the price of not paying, so a
 * customer who could lift either could lift both. Closing is theirs, from active or
 * from billing's read-only mode, because that is how somebody leaves. Closing a
 * workspace an operator suspended is not, because a closed workspace is erased.
 * Reopening is theirs only when they closed it while it was active.
 */
export function refuseOwnLifecycleMove(
  from: TenantLifecycle,
  to: TenantState,
): string | null {
  if (from.state === to) {
    return `This workspace is already ${to}.`;
  }
  if (to === "suspended") {
    return "Only the provider can suspend a workspace.";
  }
  if (to === "active") {
    if (from.state === "closed" && from.ownerMayReopen) {
      return null;
    }
    return from.state === "closed"
      ? "Only the provider can reopen this workspace."
      : "Only the provider can lift a suspension.";
  }
  // Closing is the customer's from either "you are over your plan" mode,
  // billing's or the trial's (tenant-lifecycle.md §11 T8).
  if (
    from.state === "suspended" &&
    !from.suspendedByBilling &&
    !from.suspendedByTrial
  ) {
    return "The provider suspended this workspace, so only the provider can close it.";
  }
  return null;
}

/**
 * Why the workspace's own read-only or frozen switch may not move now, or null.
 *
 * That switch is the customer's own, and it sits on the same column the lifecycle
 * writes. So while the provider holds the workspace, the customer's switch waits,
 * or it would undo the provider's decision from Admin, General.
 */
export function refuseOwnStateChange(
  lifecycle: TenantLifecycle | null,
): string | null {
  if (!lifecycle || lifecycle.state === "active") {
    return null;
  }
  if (lifecycle.state === "closed") {
    return "This workspace is closed, so its state cannot change here.";
  }
  if (lifecycle.suspendedByTrial) {
    return "This workspace's trial ended and its people do not fit the plan it moved to, so it is read-only until somebody chooses a plan or its people fit.";
  }
  return lifecycle.suspendedByBilling
    ? "This workspace is suspended until its subscription is paid or its people fit its plan, so its state cannot change here."
    : "This workspace is suspended by its provider, so only the provider can make it active again.";
}
