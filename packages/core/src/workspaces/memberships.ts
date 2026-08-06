/**
 * Which workspaces a person belongs to, and which one this request is for.
 *
 * The list is read inside row-level security through `app.user_id`, so a
 * member sees their own memberships and nothing else (TECHNICAL-PLAN §4.1).
 */
import {
  activeOnly,
  withUser,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface Membership {
  readonly workspaceId: string;
  readonly memberId: string;
  /** The workspace's name, for the switcher. */
  readonly name: string;
  readonly slug: string;
}

/**
 * Every live membership for a user, oldest workspace first.
 *
 * The order is stable because ids are time-ordered, which matters: it decides
 * which workspace somebody lands in when they have no cookie yet.
 */
export async function listMembershipsForUser(
  pool: Pool,
  userId: string,
): Promise<readonly Membership[]> {
  if (userId === "") {
    return [];
  }
  const db = drizzle(pool);
  return withUser(db, userId, (tx) =>
    tx
      .select({
        workspaceId: workspaces.id,
        memberId: workspaceMembers.id,
        name: workspaces.name,
        slug: workspaces.slug,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          activeOnly(workspaceMembers, eq(workspaceMembers.userId, userId)),
          activeOnly(workspaces),
        ),
      )
      .orderBy(asc(workspaces.createdAt), asc(workspaces.id)),
  );
}

/**
 * The workspace a request is scoped to.
 *
 * The cookie is a hint from the browser and is treated as one: it can only
 * pick between memberships that are already in the list. A cookie naming
 * somebody else's workspace, or nothing at all, quietly resolves to the
 * member's own first workspace rather than erroring, because a stale cookie is
 * an ordinary thing and not a security event to shout about.
 */
export function resolveActiveWorkspace(
  memberships: readonly Membership[],
  cookieValue: string | undefined,
): Membership | undefined {
  const requested = memberships.find(
    (membership) => membership.workspaceId === cookieValue,
  );
  return requested ?? memberships[0];
}
