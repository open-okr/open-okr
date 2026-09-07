/**
 * The board's live stream (TECHNICAL-PLAN §4.9, P5-T11).
 *
 * The same shape `api/session/[id]/live` set at P4-T07a, and for the same
 * reasons. A client connects here and receives `board.changed` whenever
 * somebody moves, adds, edits or removes a card in this space. On receiving one
 * it re-reads the board through `tasks.board`, so row-level security and `can()`
 * stay in the loop and no card's title ever travels on the wire.
 *
 * **The access check is the board read itself.** `tasks.board` answers not-found
 * for a space this member cannot reach, so a failed read is a 404 rather than an
 * open stream that never carries anything.
 */
import { boardChannel, callAction } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { getRealtime } from "../../../../../lib/realtime";
import { requireWorkspace } from "../../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;

  let workspaceId: string;
  let userId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const pool = getPool();
  try {
    await callAction(
      { pool, workspaceId, actor: { kind: "human", userId } },
      "tasks.board",
      { spaceId },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const channel = boardChannel(workspaceId, spaceId);
  const realtime = getRealtime();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // openokr:allow-side-effect: SSE stream — this is a read-path streaming
      // response, not an outbox write. enqueue() writes bytes to the HTTP
      // response body, not to a driver or a queue.
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      const subscription = await realtime.subscribe(
        channel,
        (
          event: import("@openokr/adapters").RealtimeEvent<
            Record<string, unknown>
          >,
        ) => {
          const data = JSON.stringify(event.data);
          // openokr:allow-side-effect: SSE stream write, not an outbox write.
          controller.enqueue(
            encoder.encode(`event: ${event.name}\ndata: ${data}\n\n`),
          );
        },
      );

      request.signal.addEventListener("abort", () => {
        subscription.unsubscribe().catch(() => undefined);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
