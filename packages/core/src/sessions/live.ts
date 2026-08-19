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
