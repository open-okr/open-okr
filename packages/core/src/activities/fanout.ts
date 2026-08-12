/**
 * Notification fan-out driven from activities (TECHNICAL-PLAN §4.11,
 * P2-T07). The piece P2-T06 deliberately left undone: it built
 * subscriptions, recipient resolution and notification creation, but
 * nothing called them from a write. This is that call.
 */
import type { WorkspaceTx } from "@openokr/db";
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
  const recipients = await resolveRecipients(tx, {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    excludeMemberId: input.actorMemberId ?? undefined,
  });
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
