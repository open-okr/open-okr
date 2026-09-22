/**
 * Rejoining a copilot run after a reload (P4-T14b-b).
 *
 * **This is the half of the acceptance criterion a POST cannot do.** The
 * member asked, the run went to the background, and they reloaded. The page
 * that comes back has a thread and a message with `runStartedAt` set and no
 * completion, and this is where it listens for the rest.
 *
 * The shape is `api/feed/live`'s, set at P4-T07a: the access check is the
 * read that would show the thread, so a member who could not open the
 * conversation gets a 404 rather than an open stream that never carries
 * anything. A copilot thread belongs to one member, and `copilot.thread`
 * refuses anybody else's, so that check is the whole of what this needs.
 *
 * **What crosses the wire is the same three events the POST forwards**, so the
 * panel reads one protocol whether it asked the question in this page load or
 * in the one before it.
 *
 * **What it cannot do is replay.** A reader who rejoins halfway hears the rest
 * and sees the whole answer when the run completes, because prose is published
 * as it is produced and persisted when it is finished. `copilot/background.ts`
 * says why a write per chunk is not the alternative.
 */
import { callAction, copilotThreadChannel } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/auth";
import { getRealtime } from "../../../../lib/realtime";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return new Response("Bad request", { status: 400 });
  }

  let workspaceId: string;
  let userId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // The read that authorises the stream. It answers not-found for a thread
    // that is not this member's, which is what keeps one member's questions
    // out of another's browser.
    await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "copilot.thread",
      { threadId },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const channel = copilotThreadChannel(workspaceId, threadId);
  const realtime = getRealtime();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // openokr:allow-side-effect: SSE stream — this is a read-path streaming
      // response, not an outbox write. enqueue() writes bytes to the HTTP
      // response body, not to a driver or a queue.
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      const send = (event: string, data: unknown) => {
        // openokr:allow-side-effect: SSE stream write, not an outbox write.
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const subscription = await realtime.subscribe(
        channel,
        (
          event: import("@openokr/adapters").RealtimeEvent<
            Record<string, unknown>
          >,
        ) => {
          const data = event.data ?? {};
          if (event.name === "copilot.sources") {
            send("sources", { kind: "sources", sources: data.sources ?? [] });
            return;
          }
          if (event.name === "copilot.text") {
            send("text", { kind: "text", text: String(data.text ?? "") });
            return;
          }
          if (event.name === "copilot.done") {
            const halted = data.haltedReason;
            if (typeof halted === "string" && halted !== "") {
              send("unavailable", { kind: "unavailable", reason: halted });
            }
            send("done", {
              kind: "done",
              answerMessageId: data.answerMessageId ?? null,
              stopped: false,
            });
            subscription.unsubscribe().catch(() => undefined);
            controller.close();
          }
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
    },
  });
}
