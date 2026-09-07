/**
 * Reading one member's own finished export (TECHNICAL-PLAN §4.13, P5-T15).
 *
 * **Not a registry action, and that is the shape rather than an omission.**
 * Every other read in this product is an action, and this one answers with a
 * storage key: a caller that is not the download route has nothing to do with
 * it, and `packages/core` may not touch the storage port itself. Publishing it
 * as an action would put a key nobody can use on the public REST surface, the
 * command line and the agent tool catalogue.
 *
 * **Their own export, and an administrator's is not an exception.** The file
 * holds exactly the rows that member could see when the worker built it, so a
 * wider grant would hand somebody rows their own access never reached. The
 * filter is on the caller's own member row and there is no parameter that
 * widens it. Somebody else's export answers not-found, so a caller cannot learn
 * what other people have exported by probing identifiers.
 */
import {
  activeOnly,
  blobs,
  exportRuns,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { OperationTx } from "../operations/operation.ts";

/**
 * The blob one of this member's own exports points at, or null.
 *
 * The one read the download route makes. It answers with the storage key
 * rather than the bytes, because `packages/core` may not touch the storage
 * port; the route reads the file through it.
 */
export async function myExportBlob(
  pool: Parameters<typeof drizzle>[0],
  input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly runId: string;
  },
): Promise<{
  readonly storageKey: string;
  readonly filename: string;
  readonly contentType: string;
} | null> {
  return withWorkspace(
    drizzle(pool as never),
    input.workspaceId,
    async (tx) => {
      const memberId = await actingMemberId(tx, {
        workspaceId: input.workspaceId,
        actor: { userId: input.userId },
      });
      if (!memberId) {
        return null;
      }
      const [row] = await tx
        .select({
          filename: exportRuns.filename,
          storageKey: blobs.storageKey,
          contentType: blobs.contentType,
        })
        .from(exportRuns)
        .innerJoin(blobs, eq(blobs.id, exportRuns.blobId))
        .where(
          and(
            activeOnly(
              exportRuns,
              eq(exportRuns.workspaceId, input.workspaceId),
              eq(exportRuns.id, input.runId),
              // Theirs, not the workspace's. Not-found is the answer to
              // somebody else's export, which is the rule every protected read
              // in this product follows.
              eq(exportRuns.requestedById, memberId),
              eq(exportRuns.state, "ready"),
            ),
            activeOnly(blobs),
          ),
        )
        .limit(1);
      return row ?? null;
    },
  );
}

/** The member row behind the caller, or null when they hold none. */
export async function actingMemberId(
  tx: OperationTx,
  context: {
    readonly workspaceId: string;
    readonly actor: { readonly userId?: string };
  },
): Promise<string | null> {
  if (!context.actor.userId) {
    return null;
  }
  const [member] = await tx
    // openokr:allow-raw-read: resolving the caller's own member row, which is
    // what decides which rows the query below may return.
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, context.workspaceId),
        eq(workspaceMembers.userId, context.actor.userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  return member?.id ?? null;
}
