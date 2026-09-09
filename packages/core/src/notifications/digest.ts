import {
  activeOnly,
  activities,
  notifications,
  nudges,
  type WorkspaceTx,
} from "@openokr/db";
import { trigger } from "@openokr/method";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { renderActivity } from "../activities/renderers.ts";
import { subjectUrl } from "./links.ts";
import type { DigestItem } from "./templates.ts";
import { readerMaySeeSubject } from "./visibility.ts";

/**
 * Turning a member's notifications into digest lines (P6-G01b).
 *
 * **`renderDigest` had no caller outside the barrel since P2-T06.** The
 * template was written, the batches were created and coalesced correctly, and
 * nothing ever read a batch back, so no batched notification in the history of
 * this product had ever been delivered. The gap audit recorded it as the second
 * half of B-01. This is the piece that was missing between the two: the query
 * that says what a batch contains, in words, with a link each.
 *
 * **One builder for both digests.** A batch and the daily summary differ only
 * in which rows they collect, which is why `renderDigest`'s own comment says
 * "the shape is the same either way". The batch names its rows by `batch_id`;
 * the summary takes the member's unread and unsnoozed rows. Everything after
 * that is identical, including the access filter, and a second copy of it would
 * be a second place to forget the filter.
 */

export interface DigestItemsInput {
  readonly workspaceId: string;
  readonly memberId: string;
  /**
   * Which rows to collect, and the two callers want different sets.
   *
   * The batch drain names a batch. The daily summary takes whatever is unread
   * and not snoozed. Naming neither collects everything this member has, which
   * no caller wants and no caller does.
   */
  readonly batchId?: string;
  readonly unreadOnly?: boolean;
  /** The instance's own address, for the links. */
  readonly baseUrl: string;
  /** Defaults to now. Overridden by tests. */
  readonly now?: Date;
  /** The ceiling on one digest. A hundred lines is not a summary. */
  readonly limit?: number;
}

/**
 * How many lines one digest carries at most.
 *
 * A member who was away for a week can have hundreds of rows, and a mail with
 * hundreds of lines is not read. The count in the subject line is the honest
 * signal that there is more, and the inbox is where the rest is.
 */
export const DIGEST_ITEM_LIMIT = 20;

export interface DigestContents {
  readonly items: readonly DigestItem[];
  /**
   * Rows this member holds beyond `items`, so a caller can say "and 14 more"
   * rather than silently truncating.
   */
  readonly omitted: number;
}

/**
 * The lines one digest carries, access-filtered and linked.
 *
 * Ordered oldest first, deliberately: a digest is read top to bottom as an
 * account of what happened while somebody was away, and the newest-first order
 * the inbox uses reads backwards in prose.
 */
export async function digestItemsFor(
  tx: WorkspaceTx,
  input: DigestItemsInput,
): Promise<DigestContents> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? DIGEST_ITEM_LIMIT;

  const conditions = [
    eq(notifications.workspaceId, input.workspaceId),
    eq(notifications.recipientMemberId, input.memberId),
  ];
  if (input.batchId) {
    conditions.push(eq(notifications.batchId, input.batchId));
  }
  if (input.unreadOnly) {
    conditions.push(isNull(notifications.readAt));
    conditions.push(
      or(
        isNull(notifications.snoozedUntil),
        lte(notifications.snoozedUntil, now),
      ) as never,
    );
  }

  const rows = await tx
    .select({
      id: notifications.id,
      reason: notifications.reason,
      ownSubjectType: notifications.subjectType,
      ownSubjectId: notifications.subjectId,
      activityKind: activities.kind,
      activityPayload: activities.payload,
      activitySubjectType: activities.subjectType,
      activitySubjectId: activities.subjectId,
      ruleKey: nudges.ruleKey,
      nudgeSubjectType: nudges.subjectType,
      nudgeSubjectId: nudges.subjectId,
    })
    .from(notifications)
    .leftJoin(activities, eq(activities.id, notifications.activityId))
    .leftJoin(nudges, eq(nudges.id, notifications.nudgeId))
    .where(activeOnly(notifications, and(...conditions)))
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    // One more than the limit, so "there is more" is known without a count.
    .limit(limit + 1);

  const items: DigestItem[] = [];
  let seen = 0;
  for (const row of rows) {
    const subjectType =
      row.ownSubjectType ?? row.activitySubjectType ?? row.nudgeSubjectType;
    const subjectId =
      row.ownSubjectId ?? row.activitySubjectId ?? row.nudgeSubjectId;
    if (
      !(await readerMaySeeSubject(
        tx,
        input.workspaceId,
        input.memberId,
        subjectType ?? null,
        subjectId ?? null,
      ))
    ) {
      continue;
    }
    seen++;
    if (items.length >= limit) {
      continue;
    }
    items.push({
      summary: summaryFor(row),
      // The inbox is the fallback target, not the workspace root: a line whose
      // subject has no page still has somewhere honest to go, and it is the
      // screen the row is sitting in.
      link:
        subjectUrl(input.baseUrl, subjectType, subjectId) ??
        subjectUrl(input.baseUrl, "workspace", input.workspaceId) ??
        input.baseUrl,
    });
  }

  return { items, omitted: Math.max(0, seen - items.length) };
}

/** One line's words: the activity's own sentence, or the rule that fired. */
function summaryFor(row: {
  readonly activityKind: string | null;
  readonly activityPayload: Record<string, unknown> | null;
  readonly ruleKey: string | null;
  readonly reason: string;
}): string {
  if (row.activityKind) {
    return renderActivity(row.activityKind, row.activityPayload ?? {});
  }
  if (row.ruleKey) {
    // The condition METHOD.md states, not a sentence invented here. Per-rule
    // recipient-facing wording belongs to that document and nowhere else, which
    // is the same reason `draftFor` in nudges/deliver.ts is one line for every
    // rule.
    return trigger(row.ruleKey)?.fires ?? `Reminder: ${row.ruleKey}`;
  }
  return REASON_SUMMARIES[row.reason] ?? "Something happened here.";
}

/**
 * What a row with neither an activity nor a rule can say for itself.
 *
 * Three of the six reasons are written by producers that record no activity,
 * and "Something happened here" for a reviewer's obligation would be a digest
 * that wastes the one line it has.
 */
const REASON_SUMMARIES: Readonly<Record<string, string>> = {
  invited: "You were invited to a workspace.",
  joined: "Somebody joined the workspace.",
  mentioned: "You were mentioned.",
  role: "Your role changed.",
  review: "A check-in is waiting on your review.",
  check_in: "A reminder is waiting for you.",
};
