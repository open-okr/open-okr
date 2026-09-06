/**
 * Workspace portability actions (TECHNICAL-PLAN §7.3, P6-T05a).
 *
 * **One action, and it both reads everything and records that it did.** An
 * archive is the whole workspace, so it is a write in the sense that matters:
 * §8.2 wants an audit row naming who took a copy of a company's OKR history,
 * and §7.3 wants the `export_runs` row a person comes back to. So this is a
 * write action whose `load` phase builds the archive on the Operation's own
 * transaction, and whose `execute` records the run.
 *
 * **Built on the Operation's transaction, not a second one.** Row-level
 * security is keyed on a transaction-local setting, so the archive has to be
 * read inside a transaction that has one, and opening a second inside the
 * first would be both wrong and unnecessary: `load` already runs in the
 * writing transaction, against freshly loaded rows, which is exactly where
 * `packages/core/src/operations/operation.ts` says authorisation and reading
 * belong.
 *
 * **`full`, because the archive is not a view of the workspace but the
 * workspace.** `exports.list` settled the smaller version of this argument at
 * P5-T15: bulk extraction is its own act, and `edit` was too low even for one
 * list. A file holding every objective, check-in, comment and document is an
 * admin decision.
 *
 * **The bytes come back in the result.** The same trade `exports.list` makes
 * for a small file: the action has built it, and a download route would build
 * it again to answer a question this answer already holds. The writer refuses
 * an archive over its own memory ceiling by name, so the size of that result
 * is bounded rather than hopeful.
 */
import { exportRuns } from "@openokr/db";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { ArchiveError, MAX_ARCHIVE_BYTES } from "../portability/archive.ts";
import {
  type ExportWorkspaceResult,
  exportWorkspace,
} from "../portability/export.ts";
import { rootKeyFingerprint } from "../secrets/key-ring.ts";
import { defineWriteAction } from "./define.ts";

/** `workspace-<slug>-<date>.okr`, which is what somebody downloads. */
function archiveFilename(slug: string, at: Date): string {
  const day = at.toISOString().slice(0, 10);
  const safe = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `workspace-${safe}-${day}.okr`;
}

export const exportArchive = defineWriteAction({
  name: "workspace.exportArchive",
  summary:
    "Exports the whole workspace as a versioned, checksummed, encrypted archive. Audited.",
  input: z.object({
    /**
     * Whether to carry the bytes of every file, not only the rows.
     *
     * True is the answer for a migration and false is the answer for somebody
     * checking what an archive contains, because the rows are a few megabytes
     * and the files can be most of the workspace.
     */
    includeFiles: z.boolean().default(true),
  }),
  output: z.object({
    runId: z.uuid(),
    filename: z.string(),
    /** The archive itself, base64. */
    archiveBase64: z.string(),
    bytes: z.number().int(),
    /** SHA-256 of the file, hex. What a person checks the download against. */
    digest: z.string(),
    /** Rows per table, as the manifest records them. */
    counts: z.record(z.string(), z.number().int()),
    blobs: z.object({
      count: z.number().int(),
      bytes: z.number().int(),
    }),
    /** Files whose bytes could not be read, named rather than dropped. */
    missingFiles: z.array(z.object({ id: z.string(), filename: z.string() })),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => {
    /** Filled by `load` and read by `execute`, in that order, one transaction. */
    let built: ExportWorkspaceResult | undefined;

    return {
      requires: ACCESS_LEVELS.full,
      async load({ tx, workspaceId }) {
        const ring = context.ring;
        if (!ring) {
          // Not a validation error and not a bug: an instance with no root
          // key cannot seal anything, and saying which variable is missing is
          // the only useful answer.
          throw new OperationError(
            "forbidden",
            "This instance has no encryption key, so an archive cannot be sealed. Set OPENOKR_ENCRYPTION_KEY.",
          );
        }
        try {
          built = await exportWorkspace({
            tx,
            workspaceId,
            ring,
            // The key's fingerprint names the instance without naming
            // anything about it: not a hostname, not a secret, and stable
            // across restarts.
            instance: rootKeyFingerprint(ring.current.key.toString("base64")),
            ...(input.includeFiles && context.storage
              ? { storage: context.storage }
              : {}),
          });
        } catch (error) {
          if (error instanceof ArchiveError) {
            throw new OperationError("forbidden", error.message);
          }
          throw error;
        }
        return undefined;
      },

      async execute({ tx, workspaceId, actor }) {
        if (!built) {
          throw new OperationError(
            "forbidden",
            "The archive was not built, so there is nothing to record.",
          );
        }
        if (!actor.memberId) {
          throw new OperationError(
            "forbidden",
            "An export belongs to the member who asked for it.",
          );
        }

        const filename = archiveFilename(
          built.manifest.workspace.slug,
          new Date(built.manifest.createdAt),
        );

        // openokr:allow-mutation: the calling Operation's own transaction.
        const [run] = await tx
          .insert(exportRuns)
          .values({
            workspaceId,
            kind: "archive",
            // `list` is not nullable and an archive is not a list, so it
            // carries the kind again rather than a list name that would read
            // as one.
            list: "archive",
            // Not a spreadsheet. The column's enum is `csv` or `xlsx`, so this
            // says `csv` and the filename says what it really is, which is the
            // shape §4's own row description accepts for an archive joining a
            // list's lifecycle.
            format: "csv",
            requestedById: actor.memberId,
            // Ready, not queued: it is built and it is in this answer. A
            // queued row would tell somebody to come back for a file nothing
            // is going to write.
            state: "ready",
            rowCount: Object.values(built.manifest.counts).reduce(
              (sum, count) => sum + count,
              0,
            ),
            filename,
            finishedAt: new Date(),
          })
          .returning({ id: exportRuns.id });
        const runId = (run as { id: string }).id;

        return {
          result: {
            runId,
            filename,
            archiveBase64: built.bytes.toString("base64"),
            bytes: built.bytes.byteLength,
            digest: built.digest,
            counts: built.manifest.counts,
            blobs: built.manifest.blobs,
            missingFiles: built.missingBlobs.map((blob) => ({
              id: blob.id,
              filename: blob.filename,
            })),
          },
          activity: {
            kind: "export.taken",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: {
              list: "archive",
              format: "archive",
              rowCount: Object.values(built.manifest.counts).reduce(
                (sum, count) => sum + count,
                0,
              ),
            },
          },
          audit: {
            action: "workspace.exportArchive",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              runId,
              filename,
              digest: built.digest,
              bytes: built.bytes.byteLength,
              files: built.manifest.blobs.count,
              missingFiles: built.missingBlobs.length,
              limit: MAX_ARCHIVE_BYTES,
            },
          },
        };
      },
    };
  },
});
