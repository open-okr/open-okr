/**
 * Which accounts a single sign-on connection may attach a sign-in to.
 *
 * A connection belongs to one workspace, so what it vouches for is a person
 * of that workspace. Better Auth links a provider sign-in to any existing
 * account with the same email on its own; `auth.ts` asks this module before
 * the provider account row is written, and a refusal ends the sign-in at the
 * "account not linked" error page.
 *
 * | The account | Attach? |
 * |---|---|
 * | an active or invited member of the connection's workspace | yes |
 * | has no other sign-in method and no membership anywhere (new) | yes |
 * | anything else, including a suspended or removed member | no |
 *
 * An account Better Auth has just created for this sign-in is the "new" row:
 * it has no other method and, at the moment the account row is written,
 * either no membership yet or the one the join hook just made.
 *
 * See docs/design/sso-account-trust.md.
 */
import { includeDeleted, withUser, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

/** What the decision is made from, kept apart from the lookups. */
export interface LinkingFacts {
  /** Every membership row the account has, in any workspace. */
  readonly memberships: readonly {
    readonly workspaceId: string;
    readonly status: string;
    readonly deleted: boolean;
  }[];
  /** Whether the account already has a sign-in method of its own. */
  readonly hasOtherAccount: boolean;
}

/** The rule, pure so the table above is testable without a database. */
export function mayLinkSSOAccount(
  workspaceId: string,
  facts: LinkingFacts,
): boolean {
  const isMember = facts.memberships.some(
    (m) =>
      m.workspaceId === workspaceId &&
      !m.deleted &&
      (m.status === "active" || m.status === "invited"),
  );
  if (isMember) {
    return true;
  }
  return !facts.hasOtherAccount && facts.memberships.length === 0;
}

/** Reads the facts for one account and applies the rule. */
export async function ssoLinkAllowed(
  pool: Pool,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const db = drizzle(pool);
  const memberships = await withUser(db, userId, (tx) =>
    tx
      .select({
        workspaceId: workspaceMembers.workspaceId,
        status: workspaceMembers.status,
        deletedAt: workspaceMembers.deletedAt,
      })
      .from(workspaceMembers)
      .where(
        includeDeleted(workspaceMembers, eq(workspaceMembers.userId, userId)),
      ),
  );
  // `accounts` is Better Auth's own table and carries no workspace column.
  const { rows } = await pool.query(
    "select 1 from accounts where user_id = $1 limit 1",
    [userId],
  );
  return mayLinkSSOAccount(workspaceId, {
    memberships: memberships.map((m) => ({
      workspaceId: m.workspaceId,
      status: m.status,
      deleted: m.deletedAt !== null,
    })),
    hasOtherAccount: rows.length > 0,
  });
}
