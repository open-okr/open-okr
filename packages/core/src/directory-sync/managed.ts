/**
 * Which accounts an organisation's directory manages (docs/design/
 * account-self-service.md AS-Q3 (a), approved by Akmal on 11 November 2026).
 *
 * **An account is directory-managed when it is an active member of any
 * workspace that holds a live directory token**: one not revoked and not
 * expired. Nothing stores the fact itself. A directory can adopt an existing
 * account by looking it up by address, which leaves no trace on the member
 * row, so the token is the only thing that says a directory is in charge.
 *
 * Changing the sign-in email (plan 0.8.0 Y4) and deleting your own account
 * (Y7) both refuse such an account with "Your organisation's directory
 * manages this account. Ask your administrator." The directory finds people
 * by address, so a moved address would make its next lookup miss and
 * provision a second account at the old one.
 *
 * It also refuses a person invited by hand into a workspace that runs a
 * directory. They ask an administrator, which is the trade AS-Q3 chose over
 * a migration.
 *
 * **Read workspace by workspace, under each one's tenant setting.** Which
 * workspaces the account belongs to is the one question the user setting
 * answers; each workspace's tokens are then read under that workspace's own
 * setting, so no read steps around the tenant floor.
 */
import {
  activeOnly,
  withUser,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export async function directoryManagesAccount(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  const db = drizzle(pool);
  const memberships = await withUser(db, userId, (tx) =>
    tx
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          and(
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, "active"),
          ),
        ),
      ),
  );
  for (const { workspaceId } of memberships) {
    const { rows } = await withWorkspace(db, workspaceId, (tx) =>
      tx.execute(sql`
        select 1
          from directory_sync_tokens
         where workspace_id = ${workspaceId}
           and revoked_at is null
           and (expires_at is null or expires_at > now())
         limit 1`),
    );
    if (rows.length > 0) {
      return true;
    }
  }
  return false;
}
