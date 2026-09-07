/**
 * Which workspace, and who the run acts as (P6-T01b).
 *
 * **Two lookups that have to happen before there is a tenant scope to read
 * inside**, which is why they are here rather than behind the access getter:
 * the slug decides which workspace's setting the rest of the run applies, and
 * the email decides which member every write is authorised against. The same
 * shape `pnpm cadence:sweep` and `pnpm audit:verify` already have.
 *
 * It lives in `packages/core` rather than in the command, because the wizard
 * needs the second half of it too: a browser already knows its workspace and
 * its session, and this is what the command uses to arrive at the same two
 * facts from a slug and an address.
 */
import {
  activeOnly,
  users,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface ImportTarget {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** The user every write in the run is made as. */
  readonly userId: string;
}

export async function resolveImportTarget(
  pool: Pool,
  input: { readonly workspaceSlug: string; readonly actorEmail: string },
): Promise<ImportTarget> {
  const db = drizzle(pool);

  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    // openokr:allow-raw-read: resolving which workspace the run is for happens
    // before there is a tenant scope to read inside.
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.slug, input.workspaceSlug)))
    .limit(1);
  if (!workspace) {
    throw new Error(`No workspace has the slug "${input.workspaceSlug}".`);
  }

  const userId = await withWorkspace(db, workspace.id, async (tx) => {
    const [row] = await tx
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.status, "active"),
          eq(users.email, input.actorEmail.toLowerCase()),
        ),
      )
      .limit(1);
    return row?.userId ?? undefined;
  });
  if (!userId) {
    throw new Error(
      `"${input.actorEmail}" is not an active member of ${workspace.name}, so the import has nobody to run as.`,
    );
  }

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    userId,
  };
}

/**
 * The member row a user has in this workspace (P6-T03b).
 *
 * Every write an import makes is authorised as this member, and the FlowyTeam
 * mapper needs the id itself: a company-level objective has no owner in the
 * source, and the person running the migration is the only honest champion
 * for it. Exported rather than repeated in the importer, which depends on
 * `packages/core` alone and has no database layer of its own.
 */
export async function resolveActingMemberId(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const db = drizzle(pool);
  const memberId = await withWorkspace(db, workspaceId, async (tx) => {
    const [row] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, "active"),
        ),
      )
      .limit(1);
    return row?.id ?? undefined;
  });
  if (!memberId) {
    throw new Error(
      "The user this import runs as is not an active member of the workspace.",
    );
  }
  return memberId;
}
