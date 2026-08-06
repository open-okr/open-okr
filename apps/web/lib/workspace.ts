import {
  listMembershipsForUser,
  type Membership,
  provisionWorkspaceForUser,
  resolveActiveWorkspace,
} from "@openokr/core";
import { cookies } from "next/headers";
import { getPool } from "./auth";
import { requireSession } from "./session";

/**
 * Which workspace the current request is scoped to.
 *
 * The active workspace is remembered in a cookie, which is a hint from the
 * browser and treated as one. It is revalidated against the member's own
 * membership list on every request, so editing it by hand selects nothing that
 * was not already available. That is why it is not signed: nothing trusts it,
 * so there is nothing for a signature to protect.
 */
export const ACTIVE_WORKSPACE_COOKIE = "openokr_workspace";

export interface ActiveWorkspace {
  readonly session: Awaited<ReturnType<typeof requireSession>>;
  readonly workspace: Membership;
  readonly memberships: readonly Membership[];
}

/**
 * The signed-in member and their workspace, or a redirect to sign in.
 *
 * Repairs the unprovisioned state rather than rendering around it. Better Auth
 * runs its after-create hooks once the user row has already committed, so a
 * failure during provisioning leaves a real account with no workspace. Nobody
 * should have to sign up again because of that, and provisioning is idempotent,
 * so the fix is simply to do it now.
 */
export async function requireWorkspace(): Promise<ActiveWorkspace> {
  const session = await requireSession();
  const cookieStore = await cookies();
  const pool = getPool();

  let memberships = await listMembershipsForUser(pool, session.user.id);

  if (memberships.length === 0) {
    await provisionWorkspaceForUser(pool, {
      id: session.user.id,
      name: session.user.name,
    });
    memberships = await listMembershipsForUser(pool, session.user.id);
  }

  const requested = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const workspace = resolveActiveWorkspace(memberships, requested);

  if (!workspace) {
    // Provisioning ran and still produced nothing. Something is wrong that a
    // retry will not fix, so say so rather than render an empty shell.
    throw new Error("No workspace is available for this account.");
  }

  return { session, workspace, memberships };
}
