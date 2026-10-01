/**
 * Blob actions (TECHNICAL-PLAN §4.9, P2-T05).
 *
 * `prepareUpload` and `claimUpload` are the two halves of the flow; nothing
 * here calls the storage port (CLAUDE.md: vendor SDKs and their ports live
 * only in `packages/adapters`). `storeUpload` in `../blobs/upload.ts` drives
 * an upload between the two calls: it re-encodes an image and writes the
 * bytes, and its thumbnail, at the key `prepareUpload` returns.
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
  discardOrphanedBlob,
  findOrphanedBlobs,
  prepareBlob,
  QuotaExceededError,
  ValidationFailedError,
} from "../blobs/provisioning.ts";
import {
  readSettingsIn,
  resolveClamdSettings,
  scanJobFor,
} from "../blobs/scan.ts";
import {
  IMAGE_CONTENT_TYPES,
  THUMBNAIL_CONTENT_TYPE,
  thumbnailKeyFor,
} from "../blobs/validation.ts";
import { assertLegacyKeyFree, legacyKey } from "../imports/legacy.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { DEFAULT_ORPHAN_BLOB_MINUTES } from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { readableThroughAttachment } from "./documents.ts";

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
  // A write, so at least edit — every active member holds it on the
  // workspace's own context through workspace_standard (see
  // packages/core/src/workspaces/provisioning.ts).
  access: ACCESS_LEVELS.edit,
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

/**
 * Reserves a blob for a file an import found (P6-T04c).
 *
 * The same trade `people.importMember`, `goals.importCheckIn` and
 * `comments.importComment` made before it. `blobs.prepareUpload` attributes
 * the file to the signed-in member, which is right for somebody dragging a
 * file into a comment box and wrong for a migration: a file uploaded by a
 * colleague in 2023 belongs to that colleague, not to whoever ran the import.
 *
 * A legacy key rather than a digest, because two files can share a name, a
 * size and even a digest and still be two uploads. `blobs.prepareUpload` could
 * have taken an optional legacy key instead, but it holds only `edit`, so any
 * member could reserve a key an import later needs and the import would then
 * skip a file for a reason nobody could act on.
 *
 * **The bytes still go through the storage port, and the claim is still
 * separate.** The caller prepares, writes the bytes at the key this returns,
 * then calls `blobs.claimUpload`. Doing all three here would mark a blob `ok`
 * before its bytes existed, so a run that died in between would leave a row
 * that says a file is there when it is not.
 */
export const prepareImport = defineWriteAction({
  name: "blobs.prepareImport",
  summary:
    "Reserves a storage key for a file an import found, keeping its uploader.",
  input: z.object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.string().min(1),
    declaredSize: z.number().int().positive(),
    /** Whoever uploaded it in the source, not whoever is importing. */
    authorMemberId: z.uuid(),
    /** Required: this action exists for imports and for nothing else. */
    legacy: legacyKey,
  }),
  output: z.object({ blobId: z.uuid(), storageKey: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      await assertLegacyKeyFree(tx, workspaceId, blobs, input.legacy, "file");

      const [author] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.authorMemberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!author) {
        throw new OperationError(
          "forbidden",
          "No such member to attribute this file to.",
        );
      }

      const quotaBytes = await readQuotaBytes(tx, workspaceId);
      let prepared: Awaited<ReturnType<typeof prepareBlob>>;
      try {
        prepared = await prepareBlob(tx, {
          workspaceId,
          memberId: input.authorMemberId,
          filename: input.filename,
          contentType: input.contentType,
          declaredSize: input.declaredSize,
          quotaBytes,
          legacy: input.legacy,
          ...(actor.memberId ? { actingMemberId: actor.memberId } : {}),
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
          payload: { imported: true },
        },
        audit: {
          action: "blobs.prepareImport",
          targetType: "blob",
          targetId: prepared.blobId,
          payload: {
            filename: input.filename,
            contentType: input.contentType,
            legacyType: input.legacy.type,
            legacyId: input.legacy.id,
          },
        },
      };
    },
  }),
});
/**
 * Finalises an upload (P2-T05), and holds it for a scan when there is a
 * scanner (completeness review M-24).
 *
 * **Whether to scan is the instance's decision, never the caller's.** This is
 * a public action, so an input flag saying "no scan needed" would be a way
 * round the scanner for anybody with a token. The claim reads
 * `scan.clamd.host` itself, and with a host set the file goes to `scanning`
 * and a `blob.scan` row joins the same transaction, so the scan is enqueued
 * exactly when the claim commits.
 *
 * **`thumbnail` is a flag for the same reason.** The key is derived from the
 * blob's own storage key, so no caller can aim a preview at an object in
 * another workspace.
 */
export const claimUpload = defineWriteAction({
  name: "blobs.claimUpload",
  summary: "Finalise an upload once the bytes are in storage.",
  input: z.object({
    blobId: z.uuid(),
    actualSize: z.number().int().positive(),
    digest: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /** A thumbnail was written at the key this blob's storage key derives. */
    thumbnail: z.boolean().optional(),
  }),
  output: z.object({
    status: z.enum(["ok", "scanning"]),
    warningCrossed: z.boolean(),
  }),
  // Same reasoning as prepareUpload above.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const quotaBytes = await readQuotaBytes(tx, workspaceId);
      const scanner = await resolveClamdSettings(readSettingsIn(tx));

      let claimed: Awaited<ReturnType<typeof claimBlob>>;
      try {
        claimed = await claimBlob(tx, {
          workspaceId,
          blobId: input.blobId,
          actualSize: input.actualSize,
          digest: input.digest,
          width: input.width,
          height: input.height,
          thumbnail: input.thumbnail,
          requiresScan: scanner !== null,
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
            status: claimed.status,
          },
        },
        outbox:
          claimed.status === "scanning"
            ? [scanJobFor(workspaceId, input.blobId)]
            : [],
      };
    },
  }),
});

/**
 * The storage key behind a file or its thumbnail, after checking access
 * (P2-T05, P6-G27b, widened at completeness review M-24).
 *
 * **Only an `ok` file is served.** A file still `pending` has no bytes it can
 * vouch for, one `scanning` has not been cleared, and one `quarantined` was
 * flagged. Before M-24 this handed back the key whatever the status, which did
 * not matter while nothing ever left `ok` and would have made the scan a
 * formality the moment something did.
 *
 * **The thumbnail goes through the same door**, so a preview is exactly as
 * readable as the file it shows, no more.
 */
export const getBlobForDownload = defineReadAction({
  name: "blobs.getForDownload",
  summary: "Resolve a blob's storage key, after checking access to it.",
  input: z.object({
    blobId: z.uuid(),
    /** The file itself, or the small preview of an image. */
    variant: z.enum(["file", "thumbnail"]).optional(),
  }),
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

      try {
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId: member.id,
          resourceType: "blob",
          resourceId: input.blobId,
          requires: ACCESS_LEVELS.view,
        });
      } catch (error) {
        // Not the uploader's own file, but perhaps one hung on something this
        // reader reads, which the attachment list already shows them.
        if (
          !(error instanceof OperationError) ||
          !(await readableThroughAttachment(
            tx as OperationTx,
            context.workspaceId,
            member.id,
            input.blobId,
          ))
        ) {
          throw error;
        }
      }

      const [row] = await tx
        .select({
          storageKey: blobs.storageKey,
          filename: blobs.filename,
          contentType: blobs.contentType,
          status: blobs.status,
          thumbnailKey: blobs.thumbnailKey,
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
      if (row.status === "scanning") {
        throw new OperationError(
          "forbidden",
          "This file is still being checked for viruses. It opens once the scan finishes.",
        );
      }
      if (row.status === "quarantined") {
        throw new OperationError(
          "forbidden",
          "The virus scan held this file back, so it cannot be opened.",
        );
      }
      if (row.status !== "ok") {
        throw new OperationError("not_found", "No such file.");
      }

      if (input.variant === "thumbnail") {
        if (!row.thumbnailKey) {
          throw new OperationError("not_found", "This file has no preview.");
        }
        return {
          storageKey: row.thumbnailKey,
          filename: row.filename,
          contentType: THUMBNAIL_CONTENT_TYPE,
        };
      }
      return {
        storageKey: row.storageKey,
        filename: row.filename,
        contentType: row.contentType,
      };
    });
  },
});

/**
 * Removes every upload that was prepared and never claimed (P6-G01c).
 *
 * **`findOrphanedBlobs` and `discardOrphanedBlob` were written at P2-T05 and
 * nothing ever called them.** Their own comments said so: "unwired
 * scaffolding", "not yet built". So a prepare that failed left its row in the
 * table and, when the bytes had reached the bucket before the claim did, left
 * those there too, for good. The gap audit recorded it under B-01 with the
 * rest of the scheduled work.
 *
 * **The bytes go with the row, and in that order.** Deleting the row first and
 * failing on the object would leave bytes nothing points at, which is the
 * state this exists to end. Deleting the object first and failing on the row
 * leaves a pending row whose key is gone, and the next run tries it again:
 * that one is recoverable, so it is the order chosen.
 *
 * **A storage failure on one blob does not stop the sweep.** An object that
 * was never uploaded is the ordinary case, not an error, and it is
 * indistinguishable from a driver problem at this level. Each is counted and
 * the run reports both numbers.
 */
export const reapOrphanedBlobs = defineWriteAction({
  name: "blobs.reapOrphans",
  summary:
    "Discards every upload prepared longer ago than the workspace's orphan window and never claimed.",
  input: z.object({
    /** Overrides the workspace's own setting. For tests and an operator. */
    olderThanMinutes: z.number().int().min(1).optional(),
  }),
  output: z.object({
    discarded: z.number().int(),
    /** Rows discarded whose bytes could not be removed. */
    bytesLeft: z.number().int(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const [workspace] = await tx
        .select({ settings: workspaces.settings })
        // openokr:allow-raw-read: reading this workspace's own settings row
        // from inside the Operation, the same as `readQuotaBytes` above.
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      const configured = (
        workspace?.settings as Record<string, unknown> | undefined
      )?.orphanBlobMinutes;
      const olderThanMinutes =
        input.olderThanMinutes ??
        (typeof configured === "number"
          ? configured
          : DEFAULT_ORPHAN_BLOB_MINUTES);

      const orphans = await findOrphanedBlobs(
        tx as OperationTx,
        workspaceId,
        olderThanMinutes,
      );

      let bytesLeft = 0;
      for (const orphan of orphans) {
        if (context.storage) {
          if (IMAGE_CONTENT_TYPES.has(orphan.contentType)) {
            // An image's thumbnail is written before the claim, so an upload
            // that stopped in between can leave one. Nothing else names it.
            // Not counted: most abandoned images never got that far, and a
            // preview left behind is small and harmless.
            await context.storage
              .delete(thumbnailKeyFor(orphan.storageKey))
              .catch(() => undefined);
          }
          try {
            await context.storage.delete(orphan.storageKey);
          } catch {
            // The object may never have been uploaded, which is the ordinary
            // reason a prepare goes unclaimed and not a failure. A driver
            // problem looks the same here, so both are counted and neither
            // stops the row being discarded: leaving it would mean trying the
            // same dead key again every day.
            bytesLeft += 1;
          }
        } else {
          // No storage port. The rows still go, and the count says the bytes
          // did not, so an operator reading the log knows to sweep the bucket.
          bytesLeft += 1;
        }
        await discardOrphanedBlob(tx as OperationTx, workspaceId, orphan.id);
      }

      return {
        result: { discarded: orphans.length, bytesLeft },
        activity: {
          kind: "blob.reaped",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { discarded: orphans.length, bytesLeft, olderThanMinutes },
        },
        audit: {
          action: "blobs.reapOrphans",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { discarded: orphans.length, bytesLeft },
        },
      };
    },
  }),
});
