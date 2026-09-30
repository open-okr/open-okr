/**
 * One open board's half of presence (UIUX-PLAN §3 "Presence", completeness
 * review M-02).
 *
 * The board's stream route calls this once per connection. It announces the
 * connection on the board's presence channel, answers a newcomer at once,
 * repeats itself on the heartbeat, keeps a roster of everybody else, and says
 * it has left when the connection closes. What it hands back is member
 * identifiers: who may be *named* is decided afterwards, on the server, by
 * `boardReaders` in `packages/core`.
 *
 * **Through the Realtime port, and nowhere else.** No new service and no new
 * dependency: the same Postgres listen and notify every live screen uses.
 *
 * Kept out of the route so it can be driven with a fake port and a fake clock,
 * which is how `apps/web/test/board-live.test.tsx` proves it.
 */
import { randomUUID } from "node:crypto";
import type { Realtime, Subscription } from "@openokr/adapters";
import {
  PRESENCE_HEARTBEAT_MS,
  PresenceRoster,
  type PresenceSignal,
  presenceEvent,
  readPresenceSignal,
} from "@openokr/core";

export interface BoardPresence {
  /** Says this board has left, and stops listening. Safe to call twice. */
  close(): Promise<void>;
}

export interface JoinBoardPresenceOptions {
  readonly realtime: Realtime;
  readonly channel: string;
  /** The member whose board this is. Never in the list handed to `onChange`. */
  readonly memberId: string;
  /** Everybody else with the board open, whenever that set changes. */
  readonly onChange: (memberIds: readonly string[]) => void;
  readonly viewerId?: string;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Joins a board's presence. Rejects when the port cannot subscribe, which is
 * the caller's cue that realtime is unavailable and the board should carry on
 * without it.
 */
export async function joinBoardPresence(
  options: JoinBoardPresenceOptions,
): Promise<BoardPresence> {
  const viewerId = options.viewerId ?? randomUUID();
  const now = options.now ?? Date.now;
  const roster = new PresenceRoster();
  let closed = false;

  const say = async (kind: "here" | "left", join = false): Promise<void> => {
    const signal: PresenceSignal = {
      kind,
      memberId: options.memberId,
      viewerId,
      join,
    };
    const event = presenceEvent(signal);
    try {
      // openokr:allow-side-effect: presence is a property of this open
      // connection, not a domain write. There is no transaction for it to
      // commit with and nothing to deliver after one: the outbox would store
      // a row per heartbeat per tab for a fact that is stale in a minute.
      await options.realtime.publish(options.channel, event);
    } catch (error) {
      // A missed heartbeat is repaired by the next one. Presence is never
      // worth failing the board's stream over.
      options.onError?.(error);
    }
  };

  // Only when the others change. The roster also counts this member's own
  // other tabs, and one of those opening is no news to the person it belongs to.
  let last = "";
  const changed = () => {
    const others = roster.others(options.memberId);
    const key = others.join(",");
    if (key !== last) {
      last = key;
      options.onChange(others);
    }
  };

  const subscription: Subscription = await options.realtime.subscribe(
    options.channel,
    (event) => {
      if (closed) {
        return;
      }
      const signal = readPresenceSignal(event.name, event.data);
      if (!signal || signal.viewerId === viewerId) {
        return;
      }
      if (roster.note(signal, now())) {
        changed();
      }
      if (signal.kind === "here" && signal.join) {
        // The newcomer learns who is here now, not at the next heartbeat.
        void say("here");
      }
    },
  );

  await say("here", true);

  const timer = setInterval(() => {
    void say("here");
    if (roster.sweep(now())) {
      changed();
    }
  }, options.heartbeatMs ?? PRESENCE_HEARTBEAT_MS);
  // A heartbeat must never be what keeps a process alive at shutdown.
  timer.unref?.();

  return {
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(timer);
      await say("left");
      await subscription
        .unsubscribe()
        .catch((error: unknown) => options.onError?.(error));
    },
  };
}
