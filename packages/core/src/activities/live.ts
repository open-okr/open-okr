/**
 * Live feed inserts (TECHNICAL-PLAN §4.11, P2-T07).
 *
 * Core does not call the Realtime port directly — CLAUDE.md: vendor SDKs
 * and the ports that wrap them live only in `packages/adapters`, and
 * `Realtime` is exactly that kind of port. This gives whoever holds the
 * adapter (an app route, after an action commits) the channel name and the
 * compact event to publish, in the shape `packages/adapters/src/ports/
 * realtime.ts` already defines, without this package importing it.
 */

export interface LiveActivityEvent {
  readonly name: string;
  readonly data: {
    readonly activityId: string;
    readonly kind: string;
    readonly subjectType: string;
    readonly subjectId: string;
  };
}

/** The channel a workspace's feed listens on. */
export function workspaceFeedChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:feed`;
}

export function toLiveActivityEvent(activity: {
  readonly id: string;
  readonly kind: string;
  readonly subjectType: string;
  readonly subjectId: string;
}): LiveActivityEvent {
  return {
    name: "activity.added",
    data: {
      activityId: activity.id,
      kind: activity.kind,
      subjectType: activity.subjectType,
      subjectId: activity.subjectId,
    },
  };
}
