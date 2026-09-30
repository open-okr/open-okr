/**
 * A member's own avatar and bio (TECHNICAL-PLAN §4.1, screen S-33,
 * completeness review M-22).
 *
 * `people.updateOwnProfile` has taken both since P2-T03 and nothing could set
 * either: the profile page offered neither control. These are the three rules
 * the action needed once something could.
 *
 * **An avatar is a file the member could already open, and an image.** The id
 * used to be taken on trust, and an avatar is shown to the whole workspace, so
 * pointing it at somebody else's attachment would have published that file.
 *
 * **An avatar is shared with the workspace while it is one.** A blob is born
 * readable by its uploader alone (`prepareBlob`), which is right for a file
 * dropped into a comment and wrong for a face everybody is meant to see. So
 * setting it binds the workspace's standard group at `view` on the blob's
 * context, and replacing or clearing it takes that binding back: somebody who
 * removes their photo expects it to stop being shown. A guest never holds the
 * standard group, so a guest sees initials, which is the least a guest is
 * given everywhere else.
 */
import { activeOnly, blobs, type WorkspaceTx } from "@openokr/db";
import { eq } from "drizzle-orm";
import {
  bindGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped, resolveSubjectContext } from "../access/reads.ts";
import { IMAGE_CONTENT_TYPES } from "../blobs/validation.ts";
import { OperationError } from "../operations/errors.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** A file that has been checked and may become this member's avatar. */
export interface AvatarImage {
  readonly blobId: string;
  readonly contextId: string;
}

/**
 * The file, if it may be an avatar, or a refusal.
 *
 * Through the access getter, so a file this member cannot open is not-found
 * rather than forbidden: whether somebody else's file exists is not something
 * this action should answer. Then the file itself: an image, and one whose
 * bytes are stored. `scanning` is accepted, because the thumbnail route
 * serves nothing until the scan clears it and the profile shows initials
 * until then; `pending` has no bytes and `quarantined` was held back.
 */
export async function requireAvatarImage<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly blobId: string;
  },
): Promise<AvatarImage> {
  const scoped = await getAccessScoped(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    resourceType: "blob",
    resourceId: input.blobId,
    requires: ACCESS_LEVELS.view,
  });

  const [file] = await tx
    .select({ contentType: blobs.contentType, status: blobs.status })
    .from(blobs)
    .where(
      activeOnly(
        blobs,
        eq(blobs.id, input.blobId),
        eq(blobs.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!file) {
    throw new OperationError(
      "not_found",
      "No such blob, or you do not have access to it.",
    );
  }
  if (!IMAGE_CONTENT_TYPES.has(file.contentType)) {
    throw new OperationError(
      "forbidden",
      "An avatar must be a PNG, JPEG, GIF or WebP image.",
    );
  }
  if (file.status !== "ok" && file.status !== "scanning") {
    throw new OperationError(
      "forbidden",
      "That file is not ready to be an avatar. Upload the picture again.",
    );
  }
  return { blobId: input.blobId, contextId: scoped.contextId };
}

/**
 * Shares the new avatar with the workspace and withdraws the old one.
 *
 * Called from inside `people.updateOwnProfile`'s own transaction, so the
 * member row, the bindings, the activity and the audit row commit together.
 */
export async function shareAvatar<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly previousBlobId: string | null;
    readonly next: AvatarImage | null;
  },
): Promise<void> {
  const everybody = await ensureWorkspaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
  });
  if (input.next) {
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: everybody,
      contextId: input.next.contextId,
      level: ACCESS_LEVELS.view,
    });
  }
  if (input.previousBlobId && input.previousBlobId !== input.next?.blobId) {
    const previous = await resolveSubjectContext(
      tx,
      "blob",
      input.previousBlobId,
      input.workspaceId,
    );
    if (previous) {
      await unbindGroup(tx, {
        workspaceId: input.workspaceId,
        groupId: everybody,
        contextId: previous.contextId,
      });
    }
  }
}

/**
 * A document with nothing in it: only empty paragraphs, which is what an
 * editor hands back once everything has been deleted from it.
 *
 * Structural rather than by extracting text, because a document holding only
 * a mention or an attachment has no text of its own and is still not empty.
 */
export function isBlankDocument(document: unknown): boolean {
  const content = (document as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.every((node) => {
    const block = node as { type?: unknown; content?: unknown };
    return (
      block.type === "paragraph" &&
      (!Array.isArray(block.content) || block.content.length === 0)
    );
  });
}
