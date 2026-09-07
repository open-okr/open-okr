/**
 * Realtime channel names and event types for live session sync (P4-T07a).
 *
 * Follows the same pattern as `packages/core/src/activities/live.ts`:
 * `packages/core` must not import `packages/adapters`, so the action returns
 * the channel name and the event payload and the route handler calls
 * the realtime port's publish method in the route handler.
 *
 * Every connected client that receives `session.stageChanged` re-fetches the
 * session through the normal read path. Events carry identifiers only, never
 * protected content, per the realtime port contract.
 */

/** The channel a session's participants listen on. */
export function sessionChannel(workspaceId: string, sessionId: string): string {
  return `workspace:${workspaceId}:session:${sessionId}`;
}

export interface SessionStageChangedEvent {
  readonly name: "session.stageChanged";
  readonly data: {
    readonly sessionId: string;
    readonly stageKey: string | null;
    readonly state: string;
  };
}

/**
 * One objective's score has been revealed to the room (METHOD.md §8.3,
 * P4-T10b-b).
 *
 * Identifiers only, like every event on this channel. A client that receives it
 * re-reads `sessions.scoringStatus` through the normal path, so row-level
 * security and `can()` stay in the loop and the number itself never travels on
 * the wire.
 */
export interface SessionScoresRevealedEvent {
  readonly name: "session.scoresRevealed";
  readonly data: {
    readonly sessionId: string;
    readonly goalId: string;
  };
}
