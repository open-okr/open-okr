/**
 * The board's realtime channel and its events (TECHNICAL-PLAN §4.9, P5-T11).
 *
 * The same shape `sessions/live.ts` set: `packages/core` must not import
 * `packages/adapters`, so an action returns a channel name and a payload on an
 * outbox row, and the relay's `publishEvent` handler is what actually publishes.
 *
 * **Identifiers only.** A client that receives one of these re-reads the board
 * through `tasks.board`, so row-level security and `can()` stay in the loop and
 * a card's title never travels on the wire to somebody who may not read it.
 *
 * The channel is the space's, not the board's. Three boards read one set of
 * rows, so an event about a card has to reach whoever is watching any of them.
 */

/** The channel everybody looking at one space's work listens on. */
export function boardChannel(workspaceId: string, spaceId: string): string {
  return `workspace:${workspaceId}:board:${spaceId}`;
}

export interface BoardChangedEvent {
  readonly name: "board.changed";
  readonly data: {
    readonly spaceId: string;
    readonly taskId: string;
    /** What happened, so a client can decide whether to animate anything. */
    readonly change: "created" | "moved" | "updated" | "deleted";
  };
}
