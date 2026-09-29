/**
 * Notification fan-out driven from activities (TECHNICAL-PLAN §4.11,
 * P2-T07). The piece P2-T06 deliberately left undone: it built
 * subscriptions, recipient resolution and notification creation, but
 * nothing called them from a write. This is that call.
 */
import { activeOnly, notifications, type WorkspaceTx } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { notifyRecipients } from "../notifications/create.ts";
import { resolveRecipients } from "../notifications/recipients.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface FanOutActivityInput {
  readonly workspaceId: string;
  readonly activityId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** Never notified about their own activity. */
  readonly actorMemberId: string | null;
}

export async function fanOutActivity<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: FanOutActivityInput): Promise<void> {
  // **One notification per person per event** (completeness review H-13).
  // A write may already have told somebody about this subject in its own
  // words, as a published check-in tells its reviewer they owe a review, and
  // the watcher's copy would be the same event twice. `now()` is the
  // transaction's start, which every row this write inserted carries.
  const already = new Set(
    (
      await tx
        .select({ memberId: notifications.recipientMemberId })
        .from(notifications)
        .where(
          activeOnly(
            notifications,
            eq(notifications.workspaceId, input.workspaceId),
            eq(notifications.subjectType, input.subjectType),
            eq(notifications.subjectId, input.subjectId),
            sql`${notifications.createdAt} = now()`,
          ),
        )
    ).map((row) => row.memberId),
  );
  const recipients = (
    await resolveRecipients(tx, {
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      excludeMemberId: input.actorMemberId ?? undefined,
    })
  ).filter((recipient) => !already.has(recipient.memberId));
  if (recipients.length === 0) {
    return;
  }
  await notifyRecipients(tx, {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    activityId: input.activityId,
    recipients,
  });
}
