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
 * **Three writes, in the order the contract requires.** `prepareUpload`
 * reserves the row and the key and is where the workspace's byte quota is
 * enforced; the bytes then go to storage; `claimUpload` records the size and
 * the digest that was actually written, which is what makes a half-finished
 * upload distinguishable from a finished one. Anything that stops between the
 * first and the second is an orphan, and P6-G01c's sweep is what collects it.
 *
 * **The bytes go through the port, on the server.** A presigned URL straight
 * to S3 would be the usual answer and it is the wrong one for a product that
 * must run against local disk with no object store at all: the port has two
 * drivers and only one of them can sign anything.
 */

import { createHash } from "node:crypto";
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "./auth";
import { getStorage } from "./storage";
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
    return { error: "Choose a file first." };
  }
  if (subjectType === "" || subjectId === "") {
    return { error: "That upload names nothing to attach to." };
  }

  const ctx = await context();
  try {
    const reserved = await callAction(ctx, "blobs.prepareUpload", {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      declaredSize: file.size,
    });

    const bytes = Buffer.from(await file.arrayBuffer());
    await getStorage().put(reserved.storageKey, bytes, {
      contentType: file.type || "application/octet-stream",
    });

    // **The size and digest of what was written, not of what was promised.**
    // `declaredSize` came from the browser and this does not.
    await callAction(ctx, "blobs.claimUpload", {
      blobId: reserved.blobId,
      actualSize: bytes.byteLength,
      digest: createHash("sha256").update(bytes).digest("hex"),
    });

    await callAction(ctx, "attachments.attach", {
      subjectType: subjectType as never,
      subjectId,
      blobId: reserved.blobId,
    });
  } catch (error) {
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
