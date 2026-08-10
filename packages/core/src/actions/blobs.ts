/**
 * Blob actions (TECHNICAL-PLAN §4.9, P2-T05).
 *
 * `prepareUpload` and `claimUpload` are the two halves of the flow; nothing
 * here calls the storage port (CLAUDE.md: vendor SDKs and their ports live
 * only in `packages/adapters`). Whichever app route drives an actual upload
 * calls `FileStorage.put` with the key `prepareUpload` returns, in between
 * the two calls to this registry.
 */
import {
  activeOnly,
  blobs,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import {
  claimBlob,
  prepareBlob,
  QuotaExceededError,
  ValidationFailedError,
} from "../blobs/provisioning.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** The workspace's own byte ceiling, resolved from its settings. */
async function readQuotaBytes(
  tx: OperationTx,
  workspaceId: string,
): Promise<number> {
  const [workspace] = await tx
    .select({ settings: workspaces.settings })
    // openokr:allow-raw-read: this helper is called only from inside an
    // Operation's execute (blobs.prepareUpload, blobs.claimUpload).
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
    .limit(1);
  return Number(
    (workspace?.settings as Record<string, unknown> | undefined)
      ?.storageQuotaBytes ?? 0,
  );
}

/** `prepareBlob`/`claimBlob` throw their own error types; the registry only ever hands back an `OperationError`. */
const asOperationError = (error: unknown): OperationError => {
  if (
    error instanceof QuotaExceededError ||
    error instanceof ValidationFailedError
  ) {
    return new OperationError("forbidden", error.message);
  }
  throw error;
};

export const prepareUpload = defineWriteAction({
  name: "blobs.prepareUpload",
  summary: "Reserve a storage key for an upload, after validating it.",
  input: z.object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.string().min(1),
    declaredSize: z.number().int().positive(),
  }),
  output: z.object({ blobId: z.uuid(), storageKey: z.string() }),
  access: ACCESS_LEVELS.view,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError(
          "forbidden",
          "No member to attribute this upload to.",
        );
      }
      const quotaBytes = await readQuotaBytes(tx, workspaceId);

      let prepared: Awaited<ReturnType<typeof prepareBlob>>;
      try {
        prepared = await prepareBlob(tx, {
          workspaceId,
          memberId: actor.memberId,
          filename: input.filename,
          contentType: input.contentType,
          declaredSize: input.declaredSize,
          quotaBytes,
        });
      } catch (error) {
        throw asOperationError(error);
      }

      return {
        result: prepared,
        activity: {
          kind: "blob.prepared",
          subjectType: "blob",
          subjectId: prepared.blobId,
        },
        audit: {
          action: "blobs.prepareUpload",
          targetType: "blob",
          targetId: prepared.blobId,
          payload: {
            filename: input.filename,
            contentType: input.contentType,
          },
        },
      };
    },
  }),
});

export const claimUpload = defineWriteAction({
  name: "blobs.claimUpload",
  summary: "Finalise an upload once the bytes are in storage.",
  input: z.object({
    blobId: z.uuid(),
    actualSize: z.number().int().positive(),
    digest: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  output: z.object({
    status: z.enum(["ok", "scanning"]),
    warningCrossed: z.boolean(),
  }),
  access: ACCESS_LEVELS.view,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const quotaBytes = await readQuotaBytes(tx, workspaceId);

      let claimed: Awaited<ReturnType<typeof claimBlob>>;
      try {
        claimed = await claimBlob(tx, {
          workspaceId,
          blobId: input.blobId,
          actualSize: input.actualSize,
          digest: input.digest,
          width: input.width,
          height: input.height,
          quotaBytes,
        });
      } catch (error) {
        throw asOperationError(error);
      }

      return {
        result: {
          status: claimed.status,
          warningCrossed: claimed.warningCrossed,
        },
        activity: {
          kind: "blob.claimed",
          subjectType: "blob",
          subjectId: input.blobId,
          payload: { warningCrossed: claimed.warningCrossed },
        },
        audit: {
          action: "blobs.claimUpload",
          targetType: "blob",
          targetId: input.blobId,
          payload: {
            usedAfterBytes: claimed.usedAfterBytes,
            warningCrossed: claimed.warningCrossed,
          },
        },
      };
    },
  }),
});

export const getBlobForDownload = defineReadAction({
  name: "blobs.getForDownload",
  summary: "Resolve a blob's storage key, after checking access to it.",
  input: z.object({ blobId: z.uuid() }),
  output: z.object({
    storageKey: z.string(),
    filename: z.string(),
    contentType: z.string(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const userId = context.actor.userId;
      if (!userId) {
        throw new OperationError("not_found", "No such file.");
      }
      const [member] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OperationError("not_found", "No such file.");
      }

      await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId: member.id,
        resourceType: "blob",
        resourceId: input.blobId,
        requires: ACCESS_LEVELS.view,
      });

      const [row] = await tx
        .select({
          storageKey: blobs.storageKey,
          filename: blobs.filename,
          contentType: blobs.contentType,
        })
        .from(blobs)
        .where(
          activeOnly(
            blobs,
            eq(blobs.id, input.blobId),
            eq(blobs.workspaceId, context.workspaceId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such file.");
      }
      return row;
    });
  },
});
