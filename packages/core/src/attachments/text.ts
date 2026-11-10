/**
 * Attachment rows from the text (docs/design/rich-text-editor.md §11, plan
 * 0.7.0 R2).
 *
 * A file pasted into a comment or a document is an `attachment` node naming a
 * blob. Without a row nothing said the file belonged to the text, so only its
 * uploader could open it, and every reader of the comment saw a filename that
 * led nowhere. Each write that saves a comment's or a document's text calls
 * this inside its own Operation, the way the comment write already
 * reconciles mentions, so the six writes §11 D3 names cannot differ.
 *
 * | The file | The rows |
 * |---|---|
 * | In the text, no live row | A `text` row, after the highest position, in order of appearance (D5) |
 * | In the text, a live row of either origin | Nothing |
 * | A live `text` row, no longer in the text | Soft-deleted |
 * | A `panel` row | Never touched (D4) |
 *
 * For a document, "in the text" is the body being written or any published
 * version's (D6), so a picture in version 1 still opens after version 2
 * dropped it. A version's files only keep a row; they never add one, because
 * the writer cannot change a version and should not be refused over one.
 */
import { activeOnly, attachments, blobs } from "@openokr/db";
import { eq, inArray } from "drizzle-orm";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { extractAttachments } from "../rich-text/extract.ts";
import { canOpenBlob } from "./access.ts";

export interface TextAttachmentChange {
  /** Blob ids that gained a `text` row, for the audit payload (D13). */
  readonly attachmentsAdded: readonly string[];
  /** Blob ids whose `text` row was soft-deleted. */
  readonly attachmentsRemoved: readonly string[];
}

export const NO_ATTACHMENT_CHANGE: TextAttachmentChange = {
  attachmentsAdded: [],
  attachmentsRemoved: [],
};

/** §11 D7: another member's private file, a missing one, or one elsewhere. */
const NOT_YOURS_TO_SHARE = "A file in this text is not one you can share here.";

/** §11 D8: prepared and never claimed, so there are no bytes to point at. */
const NEVER_FINISHED =
  "A file in this text never finished uploading. Take it out and add it again.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ready files a text names, each once, in the order they appear. */
function filesIn(body: unknown): string[] {
  const seen = new Set<string>();
  for (const file of extractAttachments(body)) {
    if (
      file.status === "ready" &&
      file.blobId !== undefined &&
      UUID.test(file.blobId)
    ) {
      seen.add(file.blobId);
    }
  }
  return [...seen];
}

export interface ReconcileTextAttachmentsInput {
  readonly workspaceId: string;
  /** Who is writing. A new row asks whether they may open its file (D7). */
  readonly memberId: string;
  readonly subjectType: "comment" | "document";
  readonly subjectId: string;
  /** The text being saved. Null when it was cleared. */
  readonly body: unknown;
  /** Texts whose files keep their rows: a document's published versions. */
  readonly kept?: readonly unknown[];
}

export async function reconcileTextAttachments(
  tx: OperationTx,
  input: ReconcileTextAttachmentsInput,
): Promise<TextAttachmentChange> {
  const named = input.body === null ? [] : filesIn(input.body);
  const keep = new Set(named);
  for (const body of input.kept ?? []) {
    for (const blobId of filesIn(body)) {
      keep.add(blobId);
    }
  }

  const live = await tx
    .select({
      id: attachments.id,
      blobId: attachments.blobId,
      origin: attachments.origin,
      position: attachments.position,
    })
    .from(attachments)
    .where(
      activeOnly(
        attachments,
        eq(attachments.workspaceId, input.workspaceId),
        eq(attachments.subjectType, input.subjectType),
        eq(attachments.subjectId, input.subjectId),
      ),
    );
  const attached = new Set(live.map((row) => row.blobId));

  const added = named.filter((blobId) => !attached.has(blobId));
  for (const blobId of added) {
    await requireShareable(tx, input.workspaceId, input.memberId, blobId);
  }

  if (added.length > 0) {
    const highest = live.reduce((top, row) => Math.max(top, row.position), 0);
    // openokr:allow-mutation: inside the calling Operation's own transaction.
    await tx.insert(attachments).values(
      added.map((blobId, index) => ({
        workspaceId: input.workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        blobId,
        position: highest + index + 1,
        origin: "text" as const,
      })),
    );
  }

  const dropped = live.filter(
    (row) => row.origin === "text" && !keep.has(row.blobId),
  );
  if (dropped.length > 0) {
    const now = new Date();
    // openokr:allow-mutation: inside the calling Operation's own transaction.
    await tx
      .update(attachments)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        activeOnly(
          attachments,
          eq(attachments.workspaceId, input.workspaceId),
          inArray(
            attachments.id,
            dropped.map((row) => row.id),
          ),
        ),
      );
  }

  return {
    attachmentsAdded: added,
    attachmentsRemoved: dropped.map((row) => row.blobId),
  };
}

/**
 * Refuses a file the writer may not show to the text's readers (D7), or one
 * with no bytes behind it (D8).
 *
 * Access first, so a file the writer cannot open answers the same whether or
 * not it exists. `scanning` and `quarantined` are accepted, as the panel
 * accepts them; the download holds both until the scan clears them.
 */
async function requireShareable(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  blobId: string,
): Promise<void> {
  if (!(await canOpenBlob(tx, workspaceId, memberId, blobId))) {
    throw new OperationError("not_found", NOT_YOURS_TO_SHARE);
  }
  const [blob] = await tx
    .select({ status: blobs.status })
    .from(blobs)
    .where(
      activeOnly(
        blobs,
        eq(blobs.id, blobId),
        eq(blobs.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!blob) {
    throw new OperationError("not_found", NOT_YOURS_TO_SHARE);
  }
  if (blob.status === "pending") {
    throw new OperationError("forbidden", NEVER_FINISHED);
  }
}
