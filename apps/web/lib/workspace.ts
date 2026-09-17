import {
  ENROLMENT_PATH,
  heldForEnrolment,
  identityProviderManaged,
  listMembershipsForUser,
  type Membership,
  provisionWorkspaceForUser,
  requiresSecondFactor,
  resolveActiveWorkspace,
} from "@openokr/core";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
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

  await holdForSecondFactor(pool, session, workspace.workspaceId);

  return { session, workspace, memberships };
}

/**
 * Sends somebody to enrolment and leaves them there (P8-T09).
 *
 * **Here rather than in each screen**, because "before reaching any other
 * screen" is the acceptance criterion and every authenticated screen reaches
 * this function through its segment layout. A per-screen check would be a
 * list somebody has to remember to add to, and the screen they forgot would
 * be the hole.
 *
 * Nothing at all happens on a workspace that has not asked for the policy,
 * which is every workspace by default, and the setting is already loaded with
 * the membership rather than read again here.
 */
async function holdForSecondFactor(
  pool: ReturnType<typeof getPool>,
  session: Awaited<ReturnType<typeof requireSession>>,
  workspaceId: string,
): Promise<void> {
  const required = await requiresSecondFactor(pool, workspaceId);
  if (!required) {
    return;
  }

  const path = (await headers()).get("x-openokr-path") ?? "/";
  const enrolled = session.user.twoFactorEnabled === true;

  // Only asked when it can change the answer: an enrolled member is not held
  // whoever manages their account, and this is a query per page load on a
  // workspace that has switched the policy on.
  const managed =
    enrolled || !required
      ? false
      : await identityProviderManaged(pool, session.user.id);

  if (
    heldForEnrolment({
      required,
      enrolled,
      identityProviderManaged: managed,
      path,
    })
  ) {
    redirect(ENROLMENT_PATH);
  }
}
