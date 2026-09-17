/**
 * The organisation-mandated second factor (P8-T09).
 *
 * The factors themselves have shipped since P1-T05: a one-time code with
 * backup codes, and a passkey. What this adds is a workspace saying everybody
 * must hold one, and members who do not being held in the enrolment screen at
 * their next sign-in rather than asked politely and ignored.
 *
 * **An account an identity provider manages is exempt**, decided by Agung on
 * 17 September 2026. The provider already enforces whatever second factor the
 * organisation chose, and a second one held here would be a factor the
 * organisation does not administer and cannot reset, on top of one it does.
 *
 * The decision is a pure function, because "who is held, and where they are
 * still allowed to go" is the part worth being sure of, and because the gate
 * that calls it runs on every page load of every screen.
 */
import { activeOnly, withUser, withWorkspace, workspaces } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

/**
 * Where somebody held for enrolment may still go.
 *
 * The enrolment screen itself, obviously, or the hold is a loop. Signing out
 * as well: refusing to let somebody leave would be a trap rather than a
 * policy, and an account that cannot sign out cannot be handed back to an
 * administrator either.
 *
 * `/api` is not on this list because the gate runs in the page shell rather
 * than on the API surface. A held member's session is a real session and their
 * API calls still work, which is deliberate: the policy is about a person
 * reaching screens without a second factor, and breaking a running agent or a
 * command line over it would be a different rule nobody asked for.
 */
const ALLOWED_WHILE_HELD: readonly string[] = [
  "/account/security",
  "/sign-out",
];

export interface SecondFactorHoldInput {
  /** The workspace's own `requireSecondFactor` setting. */
  readonly required: boolean;
  /** Whether this account holds a second factor already. */
  readonly enrolled: boolean;
  /** Whether an identity provider manages this account. */
  readonly identityProviderManaged: boolean;
  /** The path being opened. */
  readonly path: string;
}

/** Is this person held in enrolment, for this path? */
export function heldForEnrolment(input: SecondFactorHoldInput): boolean {
  if (!input.required || input.enrolled || input.identityProviderManaged) {
    return false;
  }
  return !ALLOWED_WHILE_HELD.some(
    (allowed) => input.path === allowed || input.path.startsWith(`${allowed}/`),
  );
}

/** Where a held member is sent. */
export const ENROLMENT_PATH = "/account/security";

/**
 * Does an identity provider manage this account?
 *
 * Answered by the account links Better Auth keeps: an account that has signed
 * in through a generic OAuth provider has a row naming it, and every provider
 * this product configures is named `sso-<provider>-<workspace>` by
 * `loadSSOConnections`. A password or a passkey is not one of those.
 *
 * `accounts` is Better Auth's own table and carries no workspace column, so
 * this needs no tenant context; it is read through `withUser` all the same, so
 * the connection is never left without one on a path that runs per page load.
 */
export async function identityProviderManaged(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  const { rows } = await withUser(drizzle(pool), userId, (tx) =>
    tx.execute<{ provider_id: string }>(sql`
      select provider_id
        from accounts
       where user_id = ${userId}
         and provider_id like 'sso-%'
       limit 1`),
  );
  return rows.length > 0;
}

/**
 * Has this workspace asked everybody for a second factor?
 *
 * A read of one setting rather than the whole settings action, because this
 * runs in the shell of every authenticated screen and the action resolves an
 * actor and its access level to answer a question about the workspace rather
 * than about the reader. The value is a workspace setting, so a member of the
 * workspace may read it by definition.
 */
export async function requiresSecondFactor(
  pool: Pool,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ settings: workspaces.settings })
      // openokr:allow-raw-read: the workspace's own settings, read inside its
      // own tenant transaction by a gate that runs before any member context
      // exists. The access getter answers "may this member see this
      // resource"; the question here is what the workspace itself requires,
      // and asking the getter would need the access level this gate runs
      // ahead of.
      .from(workspaces)
      .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
      .limit(1),
  );
  return (
    (row?.settings as { requireSecondFactor?: unknown } | undefined)
      ?.requireSecondFactor === true
  );
}
