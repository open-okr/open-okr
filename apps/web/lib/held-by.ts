import { readWorkspaceLifecycle } from "@openokr/core";
import { getPool } from "./pool";

/**
 * Who holds this workspace's state when its own administrator does not
 * (docs/design/workspace-erasure.md §2), or null.
 *
 * Null on every self-hosted instance, which has no tenant record, and never fatal: a
 * screen that could not ask falls back to what it showed before.
 */
export async function heldBy(
  workspaceId: string,
): Promise<"provider" | "unpaid" | "closed" | null> {
  const lifecycle = await readWorkspaceLifecycle(getPool(), workspaceId).catch(
    () => null,
  );
  if (!lifecycle || lifecycle.state === "active") {
    return null;
  }
  if (lifecycle.state === "closed") {
    return "closed";
  }
  return lifecycle.suspendedByBilling ? "unpaid" : "provider";
}
