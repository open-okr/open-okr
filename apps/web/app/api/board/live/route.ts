/**
 * A board's live stream, for a space, an initiative or a key result
 * (TECHNICAL-PLAN §4.9, P5-T11, completeness review M-02).
 *
 * Two things travel down it:
 *
 * | Event | What it says | What the browser does |
 * |---|---|---|
 * | `board.changed` | Some card this board could show moved, and nothing more | Re-reads the board through `tasks.board` |
 * | `presence` | Who else has this board open, by name | Draws their avatars |
 *
 * **The access check is the board read itself.** `tasks.board` answers
 * not-found for a scope this member cannot reach, since M-02 it really does,
 * so a failed read is a 404 rather than an open stream. Only a reader who
 * passed it is ever announced to anybody else.
 *
 * **Changes arrive on the spaces' channels.** A card belongs to a space, never
 * to a board, so every write announces itself on its space's channel
 * (`tasks/live.ts`). A space's board listens on its own; an initiative's or a
 * key result's listens on the channels of the spaces its cards and its own
 * home sit in. The event reaches the browser as a bare ping: the identifiers on
 * the channel stay on the server, because the card they name may be one this
 * reader cannot open.
 *
 * **Presence arrives by name, and only names this reader may see.** The
 * channel carries member identifiers; `boardReaders` turns them into names for
 * this viewer, dropping anybody who cannot read the board. See
 * `lib/board-presence.ts` and `packages/core/src/tasks/presence.ts`.
 *
 * **Realtime unavailable is a 503, and the board carries on.** The board is
 * drawn by the server, so it works without this stream. A 503 tells the
 * browser's `EventSource` to stop rather than retry every three seconds, and
 * the board then shows no presence and refreshes on the reader's own writes.
 */
import type { Subscription } from "@openokr/adapters";
import {
  type BoardScope,
  boardChannel,
  boardPresenceChannel,
  boardReaders,
  callAction,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/auth";
import {
  type BoardPresence,
  joinBoardPresence,
} from "../../../../lib/board-presence";
import { getRealtime } from "../../../../lib/realtime";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The query parameter each scope is named by, the same ones `/board` takes. */
const PARAMETERS = [
  ["space", "space"],
  ["initiative", "initiative"],
  ["keyResult", "key_result"],
] as const;

/** The one scope this stream is for. Exactly one, and a real identifier. */
function scopeFrom(params: URLSearchParams): BoardScope | null {
  const named = PARAMETERS.flatMap(([parameter, kind]) => {
    const id = params.get(parameter);
    return id ? [{ kind, id }] : [];
  });
  const [scope] = named;
  if (named.length !== 1 || !scope || !UUID.test(scope.id)) {
    return null;
  }
  return scope;
}

function boardInput(scope: BoardScope) {
  switch (scope.kind) {
    case "space":
      return { spaceId: scope.id };
    case "initiative":
      return { initiativeId: scope.id };
    case "key_result":
      return { keyResultId: scope.id };
  }
}

export async function GET(request: NextRequest) {
  const scope = scopeFrom(request.nextUrl.searchParams);
  if (!scope) {
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

  const pool = getPool();
  let spaceIds: string[];
  try {
    const board = await callAction(
      { pool, workspaceId, actor: { kind: "human", userId } },
      "tasks.board",
      boardInput(scope),
    );
    spaceIds = [
      ...new Set(
        [
          board.scope.spaceId,
          ...board.columns.flatMap((column) =>
            column.cards.map((card) => card.spaceId),
          ),
        ].filter((id): id is string => id !== null),
      ),
    ];
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const subscriptions: Subscription[] = [];
  let presence: BoardPresence | null = null;

  const send = (text: string) => {
    if (!open || !controller) {
      return;
    }
    try {
      // openokr:allow-side-effect: SSE stream write, not an outbox write.
      // enqueue() writes bytes to this HTTP response body.
      controller.enqueue(encoder.encode(text));
    } catch {
      // The reader went between the check and the write. Nothing to do.
    }
  };

  const shutdown = async () => {
    if (!open) {
      return;
    }
    open = false;
    await presence?.close().catch(() => undefined);
    await Promise.all(
      subscriptions.map((one) => one.unsubscribe().catch(() => undefined)),
    );
    try {
      controller?.close();
    } catch {
      // Already closed by the other side.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
    cancel() {
      void shutdown();
    },
  });

  // Names for the members present, resolved for this viewer. Numbered, so an
  // answer that arrives after a newer one is dropped rather than drawn.
  let asked = 0;
  const announce = async (memberIds: readonly string[]) => {
    asked += 1;
    const mine = asked;
    const members = await boardReaders(pool, {
      workspaceId,
      userId,
      scope,
      memberIds,
    }).catch(() => null);
    if (members === null || mine !== asked) {
      return;
    }
    send(`event: presence\ndata: ${JSON.stringify({ members })}\n\n`);
  };

  const realtime = getRealtime();
  try {
    for (const spaceId of spaceIds) {
      subscriptions.push(
        await realtime.subscribe(boardChannel(workspaceId, spaceId), () => {
          send("event: board.changed\ndata: {}\n\n");
        }),
      );
    }
    presence = await joinBoardPresence({
      realtime,
      channel: boardPresenceChannel(workspaceId, scope),
      memberId,
      onChange: (memberIds) => {
        void announce(memberIds);
      },
    });
  } catch {
    await shutdown();
    return new Response("Realtime is unavailable", { status: 503 });
  }

  send(": heartbeat\n\n");
  request.signal.addEventListener("abort", () => {
    void shutdown();
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
