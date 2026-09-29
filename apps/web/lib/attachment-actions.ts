"use server";

/**
 * The attachment flow, which had no caller at any point (P6-G27b).
 *
 * **Seven actions and no way in.** `blobs.prepareUpload`, `blobs.claimUpload`,
 * `blobs.getForDownload`, `attachments.attach`, `attachments.list` and
 * `attachments.detach` all shipped and none of them was reachable from a
 * screen, which the gap audit recorded in §5. The quota, the digest and the
 * orphan sweep were all built for an upload nobody could perform.
 *
 * **The upload itself is `storeUpload` in core** (completeness review M-24).
 * It re-encodes an image and makes its thumbnail, reserves the row, writes the
 * bytes and claims them, in the order the contract requires. This action hands
 * it the storage and the image processor and then attaches the result, which
 * is the one step that names a subject.
 *
 * **The bytes go through the port, on the server.** A presigned URL straight
 * to S3 would be the usual answer and it is the wrong one for a product that
 * must run against local disk with no object store at all: the port has two
 * drivers and only one of them can sign anything. It is also the only way the
 * bytes can be re-encoded before they are kept.
 */

import {
  callAction,
  ImageRefusedError,
  MAX_IMAGE_PIXELS,
  OperationError,
  storeUpload,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "./auth";
import { getStorage } from "./storage";
import { getTranslations } from "./translations";
import { getImageProcessor } from "./upload-ports";
import { requireWorkspace } from "./workspace";

export interface AttachResult {
  readonly error: string | null;
}

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

const refused = (error: unknown): AttachResult => {
  if (error instanceof OperationError) {
    return { error: error.message };
  }
  throw error;
};

export async function uploadAttachment(
  formData: FormData,
): Promise<AttachResult> {
  const file = formData.get("file");
  const subjectType = String(formData.get("subjectType") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  if (!(file instanceof File) || file.size === 0) {
    const { t } = await getTranslations();
    return { error: t("attachments.chooseFirst") };
  }
  if (subjectType === "" || subjectId === "") {
    const { t } = await getTranslations();
    return { error: t("attachmentActions.uploadNamesNothing") };
  }

  const ctx = await context();
  try {
    const stored = await storeUpload(
      ctx,
      { storage: getStorage(), images: getImageProcessor() },
      {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        bytes: Buffer.from(await file.arrayBuffer()),
      },
    );

    await callAction(ctx, "attachments.attach", {
      subjectType: subjectType as never,
      subjectId,
      blobId: stored.blobId,
    });
  } catch (error) {
    // An image that is not one is the refusal a person can act on, so it is
    // said in their language. Every other refusal is the action's own words.
    if (error instanceof ImageRefusedError) {
      const { t } = await getTranslations();
      return {
        error:
          error.reason === "too_many_pixels"
            ? t("attachmentActions.imageTooLarge", {
                megapixels: MAX_IMAGE_PIXELS / 1_000_000,
              })
            : t("attachmentActions.imageUnreadable"),
      };
    }
    return refused(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}

export async function detachAttachment(input: {
  id: string;
}): Promise<AttachResult> {
  try {
    await callAction(await context(), "attachments.detach", { id: input.id });
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}
