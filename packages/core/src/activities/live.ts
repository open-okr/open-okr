/**
 * Live feed inserts (TECHNICAL-PLAN §4.11, P2-T07).
 *
 * Core does not call the Realtime port directly — CLAUDE.md: vendor SDKs
 * and the ports that wrap them live only in `packages/adapters`, and
 * `Realtime` is exactly that kind of port. This gives whoever holds the
 * adapter (an app route, after an action commits) the channel name and the
 * compact event to publish, in the shape `packages/adapters/src/ports/
 * realtime.ts` already defines, without this package importing it.
 *
 * **A feed row carries no reactions and no comments, and that is a decision
 * rather than an omission** (P6-G11c).
 *
 * The task asked for `reactions.add`, `reactions.list`, `reactions.remove` and
 * `comments.create` on a feed row, or a recorded reason for leaving them off.
 * Two facts decide it, and both are in this repository rather than in taste.
 *
 * **`aggregateFeed` collapses rows, and the collapse depends on the page the
 * reader loaded.** Consecutive activities of the same kind, actor and subject
 * become one item with a count, and which rows are consecutive depends on
 * where the reader's page boundary fell. A reaction attached to one of the
 * collapsed activities would therefore appear on one reader's screen and not
 * on another's, and move as the reader paged. There is no stable row to
 * attach anything to.
 *
 * **An activity is not an access-bearing resource.** `SUBJECT_RESOLVERS` in
 * `access/reads.ts` resolves a workspace, a blob, a space, a goal, an
 * initiative, a task, a document, a comment and a reaction. There is no
 * resolver for an activity, so `reactions.add` on one could not be authorised
 * against anything; it would fall back to the workspace, which is the coarse
 * floor rather than a check.
 *
 * Both are fixable, and neither is worth fixing for this: every subject a feed
 * row describes already takes reactions and comments on its own page, and the
 * row links there. Two doors onto the same conversation would show two counts
 * that disagree.
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

/** The topic the relay dispatches for a feed insert (P6-G11c). */
export const FEED_ADDED_TOPIC = "feed.added";

export interface FeedAddedMessage {
  readonly topic: typeof FEED_ADDED_TOPIC;
  readonly payload: {
    readonly channel: string;
    readonly workspaceId: string;
    readonly activityId: string;
    readonly actorMemberId: string | null;
  };
  readonly idempotencyKey: string;
}

/**
 * The outbox row that tells every open feed in a workspace to re-read
 * (P6-G11c).
 *
 * **One workspace channel, and the payload is deliberately thin.** The four
 * scopes S-31 names are workspace, space, goal and profile, and only two of
 * them can be addressed at write time. A goal scope is one context id, which
 * the row carries. A space scope is a *set* of context ids that the read
 * resolves, and it grows every time a goal is created in that space, so a
 * channel per space would need that set resolved on every write rather than
 * once at connect time. `activities.space_id` is not the answer either: nine
 * activity blocks out of several hundred set it, which P6-G11b recorded.
 *
 * So the event says only that the workspace's feed moved, and each scope's
 * stream route decides whether to forward it. The server render that follows
 * applies the scope filter and `can()`, which is where they belong.
 *
 * **The actor rides along so a member is not refreshed for their own write.**
 * The route drops those: the action the member just ran has already
 * re-rendered their page, and a second refresh is a flicker with no news in
 * it. The comparison happens on the server, so the id never reaches a
 * browser.
 */
export function feedAddedEvent(input: {
  readonly workspaceId: string;
  readonly activityId: string;
  readonly actorMemberId: string | null;
}): FeedAddedMessage {
  return {
    topic: FEED_ADDED_TOPIC,
    payload: {
      channel: workspaceFeedChannel(input.workspaceId),
      workspaceId: input.workspaceId,
      activityId: input.activityId,
      actorMemberId: input.actorMemberId,
    },
    idempotencyKey: `${FEED_ADDED_TOPIC}:${input.activityId}`,
  };
}
