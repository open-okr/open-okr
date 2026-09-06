/**
 * Server-Sent Events stream for live session stage synchronisation (P4-T07a).
 *
 * Clients connect here and receive `session.stageChanged` events whenever the
 * facilitator advances a stage. On receiving an event the client re-fetches
 * the session through the normal read path, which keeps row-level security
 * and `can()` in the loop. The event payload carries identifiers only, never
 * protected content.
 *
 * The Postgres realtime driver uses LISTEN/NOTIFY — no extra service beyond
 * the database the application already has.
 *
 * Access check: the caller must be authenticated and a member of the
 * session's space. `sessions.read` returns not-found for non-members, so a
 * failed read results in 404 rather than an empty stream.
 */
import { callAction, sessionChannel } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { getRealtime } from "../../../../../lib/realtime";
import { requireWorkspace } from "../../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Authenticate and resolve workspace from cookie.
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

  // Verify the caller can read this session (non-member gets not-found).
  try {
    await callAction(
      { pool, workspaceId, actor: { kind: "human", userId } },
      "sessions.read",
      { id },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const channel = sessionChannel(workspaceId, id);
  const realtime = getRealtime();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Initial heartbeat confirms the connection is live.
      // openokr:allow-side-effect: SSE stream — this is a read-path streaming
      // response, not an outbox write. enqueue() here writes bytes to the HTTP
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
