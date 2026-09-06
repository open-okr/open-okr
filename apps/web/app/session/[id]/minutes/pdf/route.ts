/**
 * The minutes as a PDF (METHOD.md §8.10, P4-T12-a).
 *
 * Rendered on the server with `@react-pdf/renderer`, approved by Agung on
 * 26 August 2026 as the one new runtime dependency this row adds. The
 * alternatives were rejected for reasons worth keeping: anything wrapping
 * Chromium adds roughly 300MB to an image P1-T09 worked down to 204MB, and the
 * low-level drawing libraries would mean computing coordinates for a document
 * whose length changes with every review.
 *
 * **The PDF is built from the same Markdown the download serves.** One document
 * function, three consumers: a second formatter would be a second record that
 * says something slightly different, which is worse than having no PDF at all.
 * The renderer here only decides type size and page breaks.
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
import { renderMinutesPdf } from "./render";

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

  const body = await renderMinutesPdf(minutesToMarkdown(minutes));

  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${minutesFilename(minutes, "pdf")}"`,
      "Cache-Control": "no-store",
    },
  });
}
