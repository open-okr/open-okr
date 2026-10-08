/**
 * Recipient resolution (TECHNICAL-PLAN §4.11, P2-T06): "Recipients resolved
 * from subscriptions and role obligations, access-checked at send time,
 * author excluded."
 *
 * **Role obligations are a goal's champion and reviewer** (UAT BUG-007). They
 * hear about their goal without having pressed Watch, because a comment on an
 * objective is addressed to the people who answer for it. They carry the
 * \`joined\` reason a watcher carries: \`role\` is the inbox's "Role change",
 * which would mislabel a comment. Resolved here, at send time, rather than written as
 * subscription rows, so every existing goal is covered without a backfill.
 * Turning the watch off still wins: a cancelled subscription on the goal
 * keeps that person out, role or not.
 *
 * Access is checked per recipient against the list's own subject, through
 * `getAccessScoped`, not assumed from subscription alone: a member can stay
 * subscribed to something they have since lost access to (a space they
 * left), and the check here is what stops that from leaking a notification
 * about content they can no longer see.
 */
import {
  activeOnly,
  goals,
  subscriptionLists,
  subscriptions,
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
  const subscribers = list
    ? await listSubscribers(tx, input.workspaceId, list.id)
    : [];
  const candidates: Recipient[] = [
    ...subscribers,
    ...(await roleHolders(tx, input, list?.id ?? null, subscribers)),
  ];
  const recipients: Recipient[] = [];

  for (const subscriber of candidates) {
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

/**
 * A goal's champion and reviewer who are not already subscribed and have not
 * turned the watch off. Every other subject type has no role obligation yet.
 */
export async function roleHolders<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: ResolveRecipientsInput,
  listId: string | null,
  subscribers: readonly Recipient[],
): Promise<Recipient[]> {
  if (input.subjectType !== "goal") {
    return [];
  }
  const [goal] = await tx
    .select({ championId: goals.championId, reviewerId: goals.reviewerId })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.id, input.subjectId),
      ),
    )
    .limit(1);
  if (!goal) {
    return [];
  }
  const declined = listId
    ? new Set(
        (
          await tx
            .select({ memberId: subscriptions.memberId })
            .from(subscriptions)
            .where(
              activeOnly(
                subscriptions,
                eq(subscriptions.workspaceId, input.workspaceId),
                eq(subscriptions.listId, listId),
                eq(subscriptions.canceled, true),
              ),
            )
        ).map((row) => row.memberId),
      )
    : new Set<string>();
  const already = new Set(subscribers.map((one) => one.memberId));
  const holders = [goal.championId, goal.reviewerId].filter(
    (memberId): memberId is string => Boolean(memberId),
  );
  return [...new Set(holders)]
    .filter((memberId) => !already.has(memberId) && !declined.has(memberId))
    .map((memberId) => ({ memberId, reason: "joined" as const }));
}
