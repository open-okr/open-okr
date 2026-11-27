/**
 * The FlowyTeam import's live progress (docs/design/flowyteam-connect.md Q4,
 * card C5).
 *
 * The shape `api/agents/live` follows. The job publishes one event per
 * domain it starts and one when it ends, on the workspace's own channel; this
 * stream carries them to the Import card so the steps move without polling.
 *
 * **The access check is the card's own read.** `imports.flowyteamConnection`
 * needs `full`, the same as the screen, so a member who could not see the card
 * gets a 404 rather than an open stream. The channel is derived from the
 * session's workspace, so a caller cannot name another workspace's.
 *
 * **Only the fields the card draws cross the wire**: the run, the domain and
 * its position, or the run's end and its status. A fresh object is built
 * from them, so anything added to the job's event later does not reach a
 * browser by accident.
 */
import { callAction, flowyteamImportChannel } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { keepAlive } from "../../../../../lib/keep-alive";
import { getRealtime } from "../../../../../lib/realtime";
import { requireWorkspace } from "../../../../../lib/workspace";

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
    await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "imports.flowyteamConnection",
      {},
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const channel = flowyteamImportChannel(workspaceId);
  const realtime = getRealtime();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // openokr:allow-side-effect: SSE stream write, not an outbox write.
      controller.enqueue(encoder.encode(": heartbeat\n\n"));
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
          const data = event.data ?? {};
          const runId = data.runId;
          if (typeof runId !== "string") {
            return;
          }
          let line: string | null = null;
          if (event.name === "imports.flowyteam.progress") {
            const { domain, index, total } = data;
            if (
              typeof domain === "string" &&
              typeof index === "number" &&
              typeof total === "number"
            ) {
              line = `event: progress\ndata: ${JSON.stringify({ runId, domain, index, total })}\n\n`;
            }
          } else if (event.name === "imports.flowyteam.finished") {
            const status = data.status === "completed" ? "completed" : "failed";
            line = `event: finished\ndata: ${JSON.stringify({ runId, status })}\n\n`;
          }
          if (line !== null) {
            // openokr:allow-side-effect: SSE stream write, not an outbox write.
            controller.enqueue(encoder.encode(line));
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
      "X-Accel-Buffering": "no",
    },
  });
}
