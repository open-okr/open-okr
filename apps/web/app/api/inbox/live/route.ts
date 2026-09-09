/**
 * The inbox's live stream (UIUX-PLAN §4 S-03, P6-G07c).
 *
 * The shape `api/session/[id]/live` set at P4-T07a and `api/board/[spaceId]`
 * followed at P5-T11. A client connects and receives `inbox.added` whenever a
 * notification row is written for it. On receiving one it re-reads the list
 * through the page's own server render, so row-level security and `can()` stay
 * in the loop and no subject title travels on the wire.
 *
 * **There is no id in this path, and that is the access check.** The other two
 * streams take a resource id and prove the caller may read it. An inbox has no
 * id to pass: it is always the caller's own, so the channel is derived from the
 * session's member and a caller cannot name somebody else's stream. A route
 * that accepted a member id would need a check to refuse every value but one.
 */
import { memberInboxChannel } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getRealtime } from "../../../../lib/realtime";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let channel: string;
  try {
    const { workspace } = await requireWorkspace();
    channel = memberInboxChannel(workspace.workspaceId, workspace.memberId);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

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
