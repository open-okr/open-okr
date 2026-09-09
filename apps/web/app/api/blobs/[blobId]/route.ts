/**
 * Downloading one attachment (P6-G27b).
 *
 * **`blobs.getForDownload` had no caller**, so a file could not be fetched
 * even in principle. It resolves the storage key and refuses a blob this
 * member cannot reach, answering not-found rather than forbidden, which is the
 * same rule every other protected read follows.
 *
 * **The bytes are served by this process rather than by a signed URL.** The
 * storage port has two drivers and only one of them can sign anything: an
 * instance on local disk has no object store to redirect to. Streaming here
 * works in both shapes, and it keeps the access check on the same request as
 * the bytes rather than on the request before them.
 */
import { callAction } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/auth";
import { getStorage } from "../../../../lib/storage";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

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

  let file: { storageKey: string; filename: string; contentType: string };
  try {
    file = await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "blobs.getForDownload",
      { blobId },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const bytes = await getStorage().get(file.storageKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.contentType,
      // `attachment`, so a file somebody uploaded is never rendered by this
      // origin. An HTML attachment served inline would run as the product.
      "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
