/**
 * Recipient resolution (TECHNICAL-PLAN §4.11, P2-T06): "Recipients resolved
 * from subscriptions and role obligations, access-checked at send time,
 * author excluded."
 *
 * Only the subscriptions half is built here. Role obligations — a
 * champion or reviewer binding implying interest on its own, with no
 * subscription row — has no concrete meaning yet: role tags exist (P2-T01)
 * but nothing ties one to a notification reason. Recorded in STATUS.md
 * rather than guessed at.
 *
 * Access is checked per recipient against the list's own subject, through
 * `getAccessScoped`, not assumed from subscription alone: a member can stay
 * subscribed to something they have since lost access to (a space they
 * left), and the check here is what stops that from leaking a notification
 * about content they can no longer see.
 */
import {
  activeOnly,
  subscriptionLists,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { listSubscribers, type SubscriptionReason } from "./subscriptions.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface ResolveRecipientsInput {
  readonly workspaceId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** Never notified about their own activity. */
  readonly excludeMemberId?: string;
}

export interface Recipient {
  readonly memberId: string;
  readonly reason: SubscriptionReason;
}

/**
 * Every subscriber who is still active and still has at least view access
 * to the subject's own resource, excluding the author. Returns an empty
 * list rather than throwing when the subject has no subscription list at
 * all — nothing to notify is not an error.
 */
export async function resolveRecipients<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ResolveRecipientsInput): Promise<Recipient[]> {
  const [list] = await tx
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
  if (!list) {
    return [];
  }

  const subscribers = await listSubscribers(tx, input.workspaceId, list.id);
  const recipients: Recipient[] = [];

  for (const subscriber of subscribers) {
    if (subscriber.memberId === input.excludeMemberId) {
      continue;
    }
    const [member] = await tx
      .select({ status: workspaceMembers.status })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.id, subscriber.memberId),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (member?.status !== "active") {
      continue;
    }

    const access = await getAccessScoped(tx, {
      workspaceId: input.workspaceId,
      memberId: subscriber.memberId,
      resourceType: input.subjectType,
      resourceId: input.subjectId,
      requires: ACCESS_LEVELS.view,
    }).catch(() => undefined);
    if (!access) {
      continue;
    }

    recipients.push(subscriber);
  }

  return recipients;
}
