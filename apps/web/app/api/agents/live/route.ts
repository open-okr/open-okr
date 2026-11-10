/**
 * The agent runs' live stream (PLAN.md §7, release 0.7.0 A11).
 *
 * The shape `api/feed/live` and `api/inbox/live` follow. A client connects and
 * receives `agentRun.changed` whenever a run in this workspace starts, takes a
 * step, halts, is cancelled or finishes. On receiving one it re-reads the page
 * through the server render, so row-level security and `can()` stay in the
 * loop and no log line travels on the wire.
 *
 * **The access check is the read that lists the runs.** `agents.listRuns`
 * needs `full`, the same as the screen, so a member who could not read the
 * run log gets a 404 rather than an open stream that never carries anything.
 * The channel is derived from the session's own workspace, so a caller cannot
 * name another workspace's.
 *
 * **What crosses the wire is the run's id and version, and nothing else.** The
 * event on the channel also carries the workspace id; the route builds a fresh
 * object from the two fields the screen compares, so anything added to the
 * outbox payload later does not reach a browser by accident.
 */
import { agentRunsChannel, callAction } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/auth";
import { keepAlive } from "../../../../lib/keep-alive";
import { getRealtime } from "../../../../lib/realtime";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
    // The read that authorises the stream, at its smallest.
    await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "agents.listRuns",
      { limit: 1 },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const channel = agentRunsChannel(workspaceId);
  const realtime = getRealtime();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // openokr:allow-side-effect: SSE stream — this is a read-path streaming
      // response, not an outbox write. enqueue() writes bytes to the HTTP
      // response body, not to a driver or a queue.
      controller.enqueue(encoder.encode(": heartbeat\n\n"));
      // Again every 25 seconds, so no proxy's idle timeout cuts a quiet
      // stream (plan 0.8.0 H11).
      keepAlive(
        // openokr:allow-side-effect: SSE stream write, not an outbox write.
        () => controller.enqueue(encoder.encode(": heartbeat\n\n")),
        request.signal,
      );

      const subscription = await realtime.subscribe(
        channel,
        (
          event: import("@openokr/adapters").RealtimeEvent<
            Record<string, unknown>
          >,
        ) => {
          const runId = event.data?.runId;
          const version = event.data?.version;
          if (typeof runId !== "string" || typeof version !== "number") {
            return;
          }
          // openokr:allow-side-effect: SSE stream write, not an outbox write.
          controller.enqueue(
            encoder.encode(
              `event: agentRun.changed\ndata: ${JSON.stringify({ runId, version })}\n\n`,
            ),
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
