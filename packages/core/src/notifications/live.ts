/**
 * Live inbox inserts (UIUX-PLAN §4 S-03, P6-G07c).
 *
 * **The obligation P6-G07b left behind.** That row was cut in two: a watch
 * control on six detail pages, and the inbox arriving at a row without a
 * reload. This is the second half, and it owns the acceptance sentence.
 *
 * Core does not hold the Realtime port, for the reason `activities/live.ts`
 * states: ports live in `packages/adapters` and this package sits below them.
 * What is here is the channel name and the compact event, published by the
 * outbox relay after the transaction that created the row commits.
 *
 * **One channel per member, not one per workspace.** An inbox row belongs to
 * exactly one recipient, and a workspace-wide channel would hand every
 * member's stream every other member's traffic, which is a disclosure even
 * when the payload carries only identifiers. The recipient is in the channel
 * name, and the route derives that name from the caller's own session rather
 * than from anything in the request, so a stream can only ever be your own.
 *
 * **Identifiers only.** Same rule as the board and the session: the event says
 * a row exists and the client re-reads through `notifications.list`, so
 * row-level security and `can()` stay in the loop and no subject title travels
 * on the wire.
 */

/** The channel one member's inbox listens on. */
export function memberInboxChannel(
  workspaceId: string,
  memberId: string,
): string {
  return `workspace:${workspaceId}:member:${memberId}:inbox`;
}

/** The topic the relay dispatches, and the event name the client listens for. */
export const INBOX_ADDED_TOPIC = "inbox.added";

export interface InboxAddedMessage {
  readonly topic: typeof INBOX_ADDED_TOPIC;
  readonly payload: {
    readonly channel: string;
    readonly workspaceId: string;
    readonly recipientMemberId: string;
    readonly notificationId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly reason: string;
  };
  readonly idempotencyKey: string;
}

/**
 * The outbox row that tells one member's open inbox to re-read.
 *
 * The key is the notification's own id, so a delivery that is retried
 * publishes once. A second row for the same member is a different
 * notification and gets its own key.
 */
export function inboxAddedEvent(input: {
  readonly workspaceId: string;
  readonly recipientMemberId: string;
  readonly notificationId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly reason: string;
}): InboxAddedMessage {
  return {
    topic: INBOX_ADDED_TOPIC,
    payload: {
      channel: memberInboxChannel(input.workspaceId, input.recipientMemberId),
      workspaceId: input.workspaceId,
      recipientMemberId: input.recipientMemberId,
      notificationId: input.notificationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.reason,
    },
    idempotencyKey: `${INBOX_ADDED_TOPIC}:${input.notificationId}`,
  };
}
