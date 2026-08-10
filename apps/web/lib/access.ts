import { resolveOwnWorkspaceAccessLevel } from "@openokr/core";
import { notFound } from "next/navigation";
import { getPool } from "./auth";
import { requireWorkspace } from "./workspace";

/**
 * The signed-in member's own access level, resolved the same way every write
 * does (P2-T08, TECHNICAL-PLAN §4.1). The module registry's navigation items
 * are compared against this number, never against a role name.
 */
export interface CurrentAccess {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly level: number;
}

/** The level a given member holds on their own workspace's context. Split
 * out from `currentAccessLevel` so a caller that already has the workspace
 * and member id at hand — the overview page, which loads them anyway —
 * does not pay for a second `requireWorkspace` round trip just to ask. */
export async function resolveAccessLevelFor(
  workspaceId: string,
  memberId: string,
): Promise<number> {
  return resolveOwnWorkspaceAccessLevel(getPool(), workspaceId, memberId);
}

export async function currentAccessLevel(): Promise<CurrentAccess> {
  const { workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  return {
    workspaceId: workspace.workspaceId,
    memberId: workspace.memberId,
    level,
  };
}

/**
 * The current access, or the not-found page: a member below `minLevel` and a
 * stranger with no membership at all get the identical page, so a denied
 * route is never an oracle for what exists (§8.1 layer 2, matching
 * `getAccessScoped`).
 */
export async function requireAccessLevel(
  minLevel: number,
): Promise<CurrentAccess> {
  const current = await currentAccessLevel();
  if (current.level < minLevel) {
    notFound();
  }
  return current;
}
