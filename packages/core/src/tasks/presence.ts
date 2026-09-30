/**
 * Who else has a board open (UIUX-PLAN §3 "Presence", PLAN.md §7, completeness
 * review M-02).
 *
 * PLAN.md §7 ships presence from day one and P5-T11 listed it among the board's
 * deliverables. What this file holds is the part with no I/O in it: the channel
 * name, the two signals, and the roster every open board keeps of the others.
 * The stream route in `apps/web` does the publishing, because presence is a
 * property of an open connection and only the process holding the connection
 * knows when it closes.
 *
 * **Nothing about presence is stored.** Who is looking at a board right now is
 * true for seconds, so it lives in the realtime port and in memory, never in a
 * table. A row per heartbeat would be a write every twenty seconds per open tab
 * for a fact nobody reads a minute later.
 *
 * **Identifiers only on the channel**, which is the realtime port's own rule.
 * A name is read on the server for the viewer who will see it, through
 * `boardReaders` in `./scope.ts`, which also decides who may be shown at all.
 *
 * **How a board learns who is already there.** An opening board says `here`
 * with `join` set. Every board already open answers with its own `here` at
 * once, rather than making the newcomer wait up to a heartbeat to learn it is
 * not alone. After that each board repeats `here` on the heartbeat, and says
 * `left` when its connection closes. A board that vanishes without saying so,
 * because a process died, drops out when its heartbeats stop.
 */
import type { BoardScope } from "./scope.ts";

/** The channel one board's presence travels on. One per board, not per space. */
export function boardPresenceChannel(
  workspaceId: string,
  scope: BoardScope,
): string {
  return `workspace:${workspaceId}:presence:board:${scope.kind}:${scope.id}`;
}

/**
 * How often an open board says it is still open.
 *
 * Not a setting and not a method threshold: it is how the connection keeps
 * itself honest, and nobody running an OKR practice has a view on it.
 */
export const PRESENCE_HEARTBEAT_MS = 20_000;

/**
 * How long a board that has stopped saying so still counts as open.
 *
 * Two missed heartbeats and a margin, so one slow notification does not make
 * somebody blink out and back.
 */
export const PRESENCE_EXPIRY_MS = 50_000;

const HERE = "presence.here";
const LEFT = "presence.left";

/** One board announcing itself, or leaving. */
export interface PresenceSignal {
  readonly kind: "here" | "left";
  /** Whose board it is. */
  readonly memberId: string;
  /**
   * Which open board. A member with the board open in two tabs has two, and
   * closing one must not make them vanish from everybody else's.
   */
  readonly viewerId: string;
  /** A board that has just opened, asking the others to answer now. */
  readonly join: boolean;
}

/** The realtime event for one signal: a name and identifiers, nothing else. */
export function presenceEvent(signal: PresenceSignal): {
  readonly name: string;
  readonly data: Record<string, unknown>;
} {
  return {
    name: signal.kind === "here" ? HERE : LEFT,
    data: {
      memberId: signal.memberId,
      viewerId: signal.viewerId,
      ...(signal.join ? { join: true } : {}),
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A signal read back off the channel, or null for anything else.
 *
 * The channel is ours, but it is a Postgres channel anybody with the database
 * can notify on, so a malformed event is ignored rather than trusted.
 */
export function readPresenceSignal(
  name: string,
  data: unknown,
): PresenceSignal | null {
  if (name !== HERE && name !== LEFT) {
    return null;
  }
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const { memberId, viewerId, join } = data as Record<string, unknown>;
  if (
    typeof memberId !== "string" ||
    typeof viewerId !== "string" ||
    !UUID.test(memberId) ||
    !UUID.test(viewerId)
  ) {
    return null;
  }
  return {
    kind: name === HERE ? "here" : "left",
    memberId,
    viewerId,
    join: join === true,
  };
}

/**
 * The boards one open board knows about.
 *
 * Keyed by viewer rather than by member, for the two-tab reason above, and
 * answered by member, because a person with two tabs is one face.
 */
export class PresenceRoster {
  readonly #viewers = new Map<
    string,
    { readonly memberId: string; at: number }
  >();

  /** Records one signal. True when the members present changed. */
  note(signal: PresenceSignal, at: number): boolean {
    const before = this.#key();
    if (signal.kind === "left") {
      this.#viewers.delete(signal.viewerId);
    } else {
      const known = this.#viewers.get(signal.viewerId);
      if (known && known.memberId === signal.memberId) {
        // Updated in place, so a heartbeat does not move anybody to the end.
        known.at = at;
      } else {
        this.#viewers.set(signal.viewerId, {
          memberId: signal.memberId,
          at,
        });
      }
    }
    return this.#key() !== before;
  }

  /** Forgets boards whose heartbeats stopped. True when anybody went. */
  sweep(at: number): boolean {
    const before = this.#key();
    for (const [viewerId, seen] of this.#viewers) {
      if (at - seen.at > PRESENCE_EXPIRY_MS) {
        this.#viewers.delete(viewerId);
      }
    }
    return this.#key() !== before;
  }

  /** Everybody with the board open except `self`, in the order they arrived. */
  others(self: string): string[] {
    const seen = new Set<string>();
    for (const { memberId } of this.#viewers.values()) {
      if (memberId !== self) {
        seen.add(memberId);
      }
    }
    return [...seen];
  }

  #key(): string {
    return [...new Set([...this.#viewers.values()].map((one) => one.memberId))]
      .sort()
      .join(",");
  }
}
