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
  /**
   * The signed-in user behind the member (P8-T04b). Carried here because
   * `requireWorkspace` already resolved it and a caller that needs both
   * would otherwise pay for a second round trip to learn something this
   * function already knew.
   */
  readonly userId: string;
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

async function currentAccessLevel(): Promise<CurrentAccess> {
  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  return {
    workspaceId: workspace.workspaceId,
    memberId: workspace.memberId,
    level,
    userId: session.user.id,
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
