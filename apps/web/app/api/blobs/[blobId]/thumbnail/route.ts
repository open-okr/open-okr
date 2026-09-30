/**
 * One image's thumbnail, for the attachment list (completeness review M-24).
 *
 * **Through the same door as the file.** `blobs.getForDownload` with the
 * thumbnail variant checks access to the blob and refuses one that is still
 * being scanned or was held back, so a preview is exactly as readable as the
 * file it shows. Every refusal answers not-found, as the download does, so a
 * preview cannot be used to learn that a file exists.
 *
 * **Inline, unlike the download.** The download is served as an attachment so
 * a file somebody uploaded is never rendered by this origin. A thumbnail is
 * different: this instance drew it, from pixels it decoded, as a WebP, so
 * there is nothing in it but a picture. `nosniff` holds the browser to the
 * type named here.
 */
import { callAction } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { readStoredFile } from "../../../../../lib/storage";
import { requireWorkspace } from "../../../../../lib/workspace";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ blobId: string }> },
) {
  const { blobId } = await params;

  let workspaceId: string;
  let userId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  let preview: { storageKey: string; contentType: string };
  try {
    preview = await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "blobs.getForDownload",
      { blobId, variant: "thumbnail" },
    );
  } catch {
    return notFound();
  }

  // The row says there is a preview and the object is gone, which a replaced
  // volume produces. The list falls back to the type icon on a 404.
  const bytes = await readStoredFile(preview.storageKey);
  if (!bytes) {
    return notFound();
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": preview.contentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Private, and short. The object under a key never changes, but access
      // can, and a member who loses it should stop seeing the picture soon.
      "Cache-Control": "private, max-age=300",
    },
  });
}
