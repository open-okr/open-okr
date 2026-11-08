import {
  readClosureSchedule,
  readWorkspaceLifecycle,
  type TenantLifecycle,
} from "@openokr/core";
import { getPool } from "./pool";

/**
 * Who holds this workspace's state when its own administrator does not
 * (docs/design/workspace-erasure.md §2 and §8).
 */
export type Hold =
  | { readonly kind: "provider" }
  | { readonly kind: "unpaid" }
  | {
      readonly kind: "closed";
      readonly closedAt: Date;
      /** Null while retention is off. */
      readonly eraseOn: Date | null;
      readonly ownerMayReopen: boolean;
    };

/**
 * Where the workspace stands with its provider, or null on every self-hosted
 * instance, which has no tenant record. Never fatal: a screen that could not ask
 * falls back to what it showed before.
 */
export function readLifecycle(
  workspaceId: string,
): Promise<TenantLifecycle | null> {
  return readWorkspaceLifecycle(getPool(), workspaceId).catch(() => null);
}

/** The hold, read from a lifecycle already in hand. Null while it is active. */
export async function holdOf(
  workspaceId: string,
  lifecycle: TenantLifecycle | null,
): Promise<Hold | null> {
  if (!lifecycle || lifecycle.state === "active") {
    return null;
  }
  if (lifecycle.state === "suspended") {
    return { kind: lifecycle.suspendedByBilling ? "unpaid" : "provider" };
  }
  const schedule = await readClosureSchedule(getPool(), workspaceId).catch(
    () => null,
  );
  return schedule
    ? { kind: "closed", ...schedule }
    : {
        kind: "closed",
        closedAt: lifecycle.closedAt ?? new Date(),
        eraseOn: null,
        ownerMayReopen: lifecycle.ownerMayReopen,
      };
}

export async function readHold(workspaceId: string): Promise<Hold | null> {
  return holdOf(workspaceId, await readLifecycle(workspaceId));
}
