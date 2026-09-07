/**
 * Collecting a finished export (TECHNICAL-PLAN §4.9, P5-T15).
 *
 * **Authorised, not signed, and that is deliberate.** The `FileStorage` port
 * also offers a time-limited signed URL, which is the right shape for an
 * attachment: a file whose audience is everybody who can read the thing it
 * hangs off. An export is not that. It holds exactly the rows one member could
 * see at the moment the worker built it, so a URL that anybody holding it could
 * redeem would be wider than the file itself. This route resolves the caller's
 * own session first and answers not-found for somebody else's export, which is
 * the rule every protected read in this product follows.
 *
 * **Not-found rather than forbidden.** Somebody else's export and an export
 * that never existed answer alike, so a caller cannot learn what other people
 * have exported by probing identifiers.
 *
 * **The bytes are read through the port.** `packages/core` may not touch
 * storage, so `myExportBlob` answers with the storage key and this route reads
 * the file with it.
 */

import { myExportBlob } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { readStoredFile } from "../../../../../lib/storage";
import { requireWorkspace } from "../../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let workspaceId: string;
  let userId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const found = await myExportBlob(getPool(), {
    workspaceId,
    userId,
    runId: id,
  });
  if (!found) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = await readStoredFile(found.storageKey);
  if (!bytes) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": found.contentType,
      // Quoted, because a list name is under nobody's control here but the
      // header's grammar is stricter than a filename.
      "content-disposition": `attachment; filename="${found.filename.replaceAll('"', "")}"`,
      "content-length": String(bytes.byteLength),
      // A person's own export, built from their own access. Never a shared
      // cache, and never a proxy's.
      "cache-control": "private, no-store",
    },
  });
}
