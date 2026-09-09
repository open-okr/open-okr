/**
 * The feed's live stream, at every scope S-31 names (P6-G11c).
 *
 * The shape `api/session/[id]/live` set at P4-T07a. One route rather than four,
 * because the four scopes differ only in which read authorises them and every
 * one of them listens on the same channel.
 *
 * **The access check is the scope's own read.** Each feed action answers
 * not-found for a subject this member cannot reach, so a failed read is a 404
 * rather than an open stream that never carries anything. That is the board
 * route's rule, and here it also settles what the stream may say: a reader who
 * could not open the panel never opens the stream behind it.
 *
 * **What crosses the wire is a bare `feed.changed` with no data at all.** The
 * event on the channel carries an activity id and an actor, and neither
 * reaches the browser: this route reads them, decides, and sends an empty
 * ping. So a member learns that their own feed may have moved and nothing
 * about what moved or where. The re-read that follows applies the scope filter
 * and `can()`, which is where those belong.
 *
 * **A member is not pinged for their own write.** The action they just ran has
 * already re-rendered their page; a second refresh is a flicker with no news
 * in it. The comparison is here rather than in the browser, so the actor's id
 * stays on the server.
 */
import {
  type ActionName,
  callAction,
  workspaceFeedChannel,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/auth";
import { getRealtime } from "../../../../lib/realtime";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

const SCOPES = ["workspace", "space", "goal", "profile"] as const;
type Scope = (typeof SCOPES)[number];

const isScope = (value: string | null): value is Scope =>
  value !== null && (SCOPES as readonly string[]).includes(value);

/** The read that proves this member may watch this scope, and its input. */
function authorising(
  scope: Scope,
  id: string | null,
): { action: ActionName; input: Record<string, unknown> } | null {
  switch (scope) {
    case "workspace":
      return { action: "activities.workspaceFeed", input: {} };
    case "space":
      return id
        ? { action: "activities.spaceFeed", input: { spaceId: id } }
        : null;
    case "goal":
      return id
        ? { action: "activities.goalFeed", input: { goalId: id } }
        : null;
    case "profile":
      return id
        ? { action: "activities.profileFeed", input: { memberId: id } }
        : null;
  }
}

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope");
  const id = request.nextUrl.searchParams.get("id");
  if (!isScope(scope)) {
    return new Response("Bad request", { status: 400 });
  }
  const read = authorising(scope, id);
  if (!read) {
    return new Response("Bad request", { status: 400 });
  }

  let workspaceId: string;
  let userId: string;
  let memberId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
    memberId = workspace.memberId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      read.action,
      // The four inputs differ and the registry types each one; this route is
      // the one place that holds all four, so the cast is here and nowhere
      // else. `authorising` above is what keeps the pairs correct.
      read.input as never,
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const channel = workspaceFeedChannel(workspaceId);
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
          if (event.data?.actorMemberId === memberId) {
            return;
          }
          // openokr:allow-side-effect: SSE stream write, not an outbox write.
          controller.enqueue(
            encoder.encode("event: feed.changed\ndata: {}\n\n"),
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
