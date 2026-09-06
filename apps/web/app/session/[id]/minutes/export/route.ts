/**
 * The minutes as a Markdown download (METHOD.md §8.10, P4-T12-a).
 *
 * Markdown because these minutes are read outside the product: pasted into a
 * wiki, mailed to a sponsor, kept in a folder. The document is built by
 * `minutesToMarkdown`, which the PDF route and the screen also use, so the three
 * cannot drift into three slightly different records.
 *
 * Access is `sessions.minutes`'s, not this route's. A non-member reads not-found
 * from the action and the download is a 404, and the management retro is already
 * absent from the payload rather than filtered here: an export that did its own
 * filtering would be a second place to get an access rule wrong.
 */
import { callAction } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { requireWorkspace } from "../../../../../lib/workspace";
import {
  type Minutes,
  minutesFilename,
  minutesToMarkdown,
} from "../minutes-document";

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

  let minutes: Minutes;
  try {
    minutes = (await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "sessions.minutes",
      { sessionId: id },
    )) as Minutes;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(minutesToMarkdown(minutes), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${minutesFilename(minutes, "md")}"`,
      // A record should not be served from a cache that outlives a correction.
      "Cache-Control": "no-store",
    },
  });
}
