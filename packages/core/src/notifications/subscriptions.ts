/**
 * Subscriptions (TECHNICAL-PLAN §4.10, P2-T06).
 *
 * One list per notifiable artifact, one row per member per list while it
 * stays live. Authors auto-join with reason `joined`; mentions auto-subscribe
 * with reason `mentioned` and are re-diffed on edit (`reconcileMentions`
 * below). Suspended, placeholder and agent members are excluded from every
 * auto-subscribe path — silently, not as a validation error, because the
 * caller (an author saving their own work, an editor naming a mention) has
 * no reason to be told about somebody else's status.
 */
import {
  activeOnly,
  type Subscription,
  subscriptionLists,
  subscriptions,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface EnsureSubscriptionListInput {
  readonly workspaceId: string;
  readonly subjectType: string;
  readonly subjectId: string;
}

export async function ensureSubscriptionList<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: EnsureSubscriptionListInput): Promise<string> {
  const [existing] = await tx
    .select({ id: subscriptionLists.id })
    .from(subscriptionLists)
    .where(
      activeOnly(
        subscriptionLists,
        eq(subscriptionLists.workspaceId, input.workspaceId),
        eq(subscriptionLists.subjectType, input.subjectType),
        eq(subscriptionLists.subjectId, input.subjectId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }
  // openokr:allow-mutation: called only from inside an Operation's execute,
  // on the transaction that Operation opened.
  const [row] = await tx
    .insert(subscriptionLists)
    .values({
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    })
    .returning({ id: subscriptionLists.id });
  return (row as { id: string }).id;
}

// The one list lives on the table (P3-T07). This was a hand-written copy of it,
// and a copy of a policy is a policy nobody owns: widening the column for the
// review obligation left this narrower and the two disagreed.
export type SubscriptionReason = Subscription["reason"];

export interface SubscribeMemberInput {
  readonly workspaceId: string;
  readonly listId: string;
  readonly memberId: string;
  readonly reason: SubscriptionReason;
}

/** Is this member eligible for an auto-subscribe at all? */
async function isSubscribable<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, memberId: string): Promise<boolean> {
  const [member] = await tx
    .select({ status: workspaceMembers.status, kind: workspaceMembers.kind })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return (
    member !== undefined &&
    member.status === "active" &&
    (member.kind === "human" || member.kind === "guest")
  );
}

/**
 * Subscribes a member, unless they are suspended, a placeholder or an agent,
 * in which case this is a silent no-op. Idempotent: a member already
 * subscribed to this list keeps their existing reason rather than gaining a
 * second row.
 */
export async function subscribeMember<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: SubscribeMemberInput): Promise<void> {
  if (!(await isSubscribable(tx, input.workspaceId, input.memberId))) {
    return;
  }
  const [existing] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      activeOnly(
        subscriptions,
        eq(subscriptions.listId, input.listId),
        eq(subscriptions.memberId, input.memberId),
      ),
    )
    .limit(1);
  if (existing) {
    return;
  }
  // openokr:allow-mutation: called only from inside an Operation's execute,
  // on the transaction that Operation opened.
  await tx.insert(subscriptions).values({
    workspaceId: input.workspaceId,
    listId: input.listId,
    memberId: input.memberId,
    reason: input.reason,
  });
}

export interface CancelSubscriptionInput {
  readonly workspaceId: string;
  readonly listId: string;
  readonly memberId: string;
}

export async function cancelSubscription<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CancelSubscriptionInput): Promise<void> {
  // openokr:allow-mutation: called only from inside an Operation's execute,
  // on the transaction that Operation opened.
  await tx
    .update(subscriptions)
    .set({ canceled: true, updatedAt: new Date() })
    .where(
      activeOnly(
        subscriptions,
        eq(subscriptions.listId, input.listId),
        eq(subscriptions.memberId, input.memberId),
      ),
    );
}

export interface ReconcileMentionsInput {
  readonly workspaceId: string;
  readonly listId: string;
  /** Every member mentioned in the content as it stands right now. */
  readonly mentionedMemberIds: readonly string[];
}

/**
 * Re-diffs mention subscriptions on edit: subscribes anyone newly named,
 * cancels anyone whose mention was removed. Never touches a subscription
 * held for a different reason — un-mentioning someone does not unsubscribe
 * them if they are also, say, the author.
 */
export async function reconcileMentions<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ReconcileMentionsInput): Promise<void> {
  const current = await tx
    .select({ memberId: subscriptions.memberId })
    .from(subscriptions)
    .where(
      activeOnly(
        subscriptions,
        eq(subscriptions.listId, input.listId),
        eq(subscriptions.reason, "mentioned"),
      ),
    );
  const currentIds = new Set(current.map((row) => row.memberId));
  const nextIds = new Set(input.mentionedMemberIds);

  for (const memberId of nextIds) {
    if (!currentIds.has(memberId)) {
      await subscribeMember(tx, {
        workspaceId: input.workspaceId,
        listId: input.listId,
        memberId,
        reason: "mentioned",
      });
    }
  }
  for (const memberId of currentIds) {
    if (!nextIds.has(memberId)) {
      await cancelSubscription(tx, {
        workspaceId: input.workspaceId,
        listId: input.listId,
        memberId,
      });
    }
  }
}

export interface Subscriber {
  readonly memberId: string;
  readonly reason: SubscriptionReason;
}

export async function listSubscribers<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  listId: string,
): Promise<Subscriber[]> {
  return tx
    .select({ memberId: subscriptions.memberId, reason: subscriptions.reason })
    .from(subscriptions)
    .where(
      activeOnly(
        subscriptions,
        eq(subscriptions.workspaceId, workspaceId),
        eq(subscriptions.listId, listId),
        eq(subscriptions.canceled, false),
      ),
    );
}
