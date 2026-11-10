/**
 * Who may reach the subject a file hangs on, and who may open a file
 * (TECHNICAL-PLAN §4.9, P5-T12, P6-G27b; rich-text-editor.md §11, plan 0.7.0
 * R2).
 *
 * Moved here from `actions/documents.ts` at R2, so the text reconcile in
 * `text.ts`, the files panel's actions and the download all ask one set of
 * rules without the action files importing each other.
 */
import {
  type ATTACHMENT_SUBJECT_TYPES,
  activeOnly,
  attachments,
  type DocumentSubjectType,
} from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped, getParentAccessScoped } from "../access/reads.ts";
import {
  loadReadableDocument,
  requireDocumentSubject,
} from "../documents/access.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";

type AttachmentSubject = (typeof ATTACHMENT_SUBJECT_TYPES)[number];

/**
 * Refuses unless this member may reach the subject a file is being hung on.
 *
 * Wider than a document's subject check because attachments go on more
 * things. A task and a document resolve through their own contexts; a
 * check-in through its goal; a comment through what it is on, the walk a
 * reaction on a comment takes (§11 D12). A deleted comment resolves to
 * nothing, so its files close with it (D9).
 */
export async function requireAttachmentSubject(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  kind: AttachmentSubject,
  subjectId: string,
  requires: number = ACCESS_LEVELS.view,
): Promise<void> {
  if (kind === "task") {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "task",
      resourceId: subjectId,
      requires: requires as never,
    });
    return;
  }
  if (kind === "document") {
    await loadReadableDocument(tx, workspaceId, memberId, subjectId);
    return;
  }
  if (kind === "comment") {
    await getParentAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "comment",
      resourceId: subjectId,
      requires: requires as never,
    });
    return;
  }
  if (kind === "check_in") {
    const rows = await tx.execute<{ subject_id: string }>(
      sql`select subject_id from check_ins
           where id = ${subjectId}
             and workspace_id = ${workspaceId}
             and deleted_at is null
           limit 1`,
    );
    const goalId = rows.rows[0]?.subject_id;
    if (!goalId) {
      throw new OperationError("not_found", "No such check-in.");
    }
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "goal",
      resourceId: goalId,
      requires: requires as never,
    });
    return;
  }
  await requireDocumentSubject(
    tx,
    workspaceId,
    memberId,
    kind as DocumentSubjectType,
    subjectId,
    requires,
  );
}

/**
 * Whether a member reads a file through something it hangs on.
 *
 * A blob's own context binds only its uploader, which is right while it is
 * theirs alone. Attaching it to a goal, a task, a check-in, a document or a
 * comment is showing it to whoever reads that subject, and `attachments.list`
 * already lists it to them, so the download has to agree. Found while fixing
 * completeness review M-22: the list showed a colleague a file the download
 * then refused. Checked per attachment through the same subject rule the
 * attachment itself uses, so a file hung on something you cannot read stays
 * closed to you.
 */
async function readableThroughAttachment(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  blobId: string,
): Promise<boolean> {
  const hangsOn = await tx
    .select({
      subjectType: attachments.subjectType,
      subjectId: attachments.subjectId,
    })
    .from(attachments)
    .where(
      activeOnly(
        attachments,
        eq(attachments.workspaceId, workspaceId),
        eq(attachments.blobId, blobId),
      ),
    );
  for (const subject of hangsOn) {
    try {
      await requireAttachmentSubject(
        tx,
        workspaceId,
        memberId,
        subject.subjectType,
        subject.subjectId,
        ACCESS_LEVELS.view,
      );
      return true;
    } catch (error) {
      if (!(error instanceof OperationError)) {
        throw error;
      }
    }
  }
  return false;
}

/**
 * Whether a member may open a file: their own upload, or one readable through
 * a live attachment row they reach. `blobs.getForDownload`'s rule, and the one
 * a write asks before its text shares a file (§11 D7).
 */
export async function canOpenBlob(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  blobId: string,
): Promise<boolean> {
  try {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "blob",
      resourceId: blobId,
      requires: ACCESS_LEVELS.view,
    });
    return true;
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
  }
  return readableThroughAttachment(tx, workspaceId, memberId, blobId);
}
