/**
 * Notification and subscription actions (TECHNICAL-PLAN §4.10, §4.11,
 * P2-T06). The in-app inbox: list, mark read, snooze. Settings: read and
 * update the member's own routing. Subscriptions: a self-service toggle,
 * which is what "mute" means here — canceling the subscription, the same
 * primitive `reconcileMentions` uses to remove one on edit.
 */
import {
  activeOnly,
  activities,
  NOTIFICATION_REASONS,
  notifications,
  nudges,
  subscriptionLists,
  subscriptions,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, count, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { renderActivity } from "../activities/renderers.ts";
import { claimDueBatches } from "../notifications/drain.ts";
import {
  getOrCreateNotificationSettings,
  updateNotificationSettings,
} from "../notifications/settings.ts";
import {
  cancelSubscription,
  ensureSubscriptionList,
  subscribeMember,
} from "../notifications/subscriptions.ts";
import { readerMaySeeSubject } from "../notifications/visibility.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/**
 * One inbox row (screen S-03, P6-G07a).
 *
 * **The reason enum came from the table, not from a copy of it.** It listed
 * four of the six until P6-G07a: `review` and `check_in` were added to
 * `NOTIFICATION_REASONS` at P3-T07 and P4-T04 and never reached this schema,
 * so the OpenAPI document and the command line described an inbox that could
 * not contain a reviewer's obligation or a nudge. Nothing validated the output,
 * which is why it went unnoticed, and a client that did validate would have
 * rejected the two reasons that matter most.
 */
const notificationRow = z.object({
  id: z.uuid(),
  reason: z.enum(NOTIFICATION_REASONS),
  channel: z.string(),
  readAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string(),
  /**
   * What this row is about, so it can be grouped and linked.
   *
   * Null only on a row written before migration 0074, where the activity's own
   * subject is the fallback and there is nothing to fall back to when the
   * producer wrote no activity either.
   */
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  /**
   * What happened, in the activity renderer's words: the same sentence the
   * feed shows, so the inbox and the feed can never describe one event
   * differently. Null for a nudge, which has no activity behind it.
   */
  rendered: z.string().nullable(),
  /**
   * The rule a proactive message cites (UIUX-PLAN §3: "Every proactive
   * message shows its rule"). Null for everything that is not a nudge.
   */
  ruleKey: z.string().nullable(),
  /**
   * Whether the reader still holds a live subscription to this subject, so the
   * row can offer mute without the screen guessing. False when the subject is
   * one nothing subscribes to, such as an invitation or a role change.
   */
  watching: z.boolean(),
});

/** The page the screen draws, and the ceiling the read will not go above. */
const INBOX_PAGE_SIZE = 50;

/**
 * The acting member, or null when the caller is not one.
 *
 * The inbox is addressed to a member, so a caller with no member row has no
 * inbox rather than an empty one. Returning null and letting each action decide
 * keeps the read answering `[]` where it always did, so nothing that already
 * calls it changes behaviour.
 */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string | null> {
  if (!userId) {
    return null;
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return member?.id ?? null;
}

export const listNotifications = defineReadAction({
  name: "notifications.list",
  summary: "The signed-in member's own inbox.",
  input: z.object({
    unreadOnly: z.boolean().optional(),
    /** One reason, for §3's reason filter. Absent means every reason. */
    reason: z.enum(NOTIFICATION_REASONS).optional(),
    cursor: z.object({ createdAt: z.string(), id: z.uuid() }).optional(),
  }),
  output: z.array(notificationRow),
  access: ACCESS_LEVELS.view,
  page: { cursorFrom: ["createdAt", "id"] },
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (rawTx) => {
      const tx = rawTx as OperationTx;
      const memberId = await actingMember(
        tx,
        context.workspaceId,
        context.actor.userId,
      );
      if (!memberId) {
        return [];
      }

      const now = new Date();
      const conditions = [
        eq(notifications.recipientMemberId, memberId),
        or(
          isNull(notifications.snoozedUntil),
          lte(notifications.snoozedUntil, now),
        ),
      ];
      if (input.unreadOnly) {
        conditions.push(isNull(notifications.readAt));
      }
      if (input.reason) {
        conditions.push(eq(notifications.reason, input.reason));
      }
      if (input.cursor) {
        // Keyset rather than an offset, and the id breaks the tie: two
        // notifications written in the same millisecond are ordinary in a
        // fan-out, and an offset page would show one of them twice.
        const at = new Date(input.cursor.createdAt);
        conditions.push(
          or(
            lt(notifications.createdAt, at),
            and(
              eq(notifications.createdAt, at),
              lt(notifications.id, input.cursor.id),
            ),
          ) as never,
        );
      }

      const rows = await tx
        .select({
          id: notifications.id,
          reason: notifications.reason,
          channel: notifications.channel,
          readAt: notifications.readAt,
          snoozedUntil: notifications.snoozedUntil,
          createdAt: notifications.createdAt,
          // Coalesced in that order: the row's own subject where it has one,
          // then the activity behind it for a row written before migration
          // 0074, then the nudge's. Left joins, because a row can have none.
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
        .where(
          activeOnly(
            notifications,
            eq(notifications.workspaceId, context.workspaceId),
            and(...conditions),
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(INBOX_PAGE_SIZE);

      // The subjects this reader is watching, in one query rather than one per
      // row. Only the subjects on this page, so a member watching a thousand
      // things pays for the fifty in front of them.
      const watched = await watchedSubjects(
        tx,
        context.workspaceId,
        memberId,
        rows.map((row) => ({
          subjectType:
            row.ownSubjectType ??
            row.activitySubjectType ??
            row.nudgeSubjectType,
          subjectId:
            row.ownSubjectId ?? row.activitySubjectId ?? row.nudgeSubjectId,
        })),
      );

      const visible: z.infer<typeof notificationRow>[] = [];
      for (const row of rows) {
        const subjectType =
          row.ownSubjectType ??
          row.activitySubjectType ??
          row.nudgeSubjectType ??
          null;
        const subjectId =
          row.ownSubjectId ??
          row.activitySubjectId ??
          row.nudgeSubjectId ??
          null;
        if (
          !(await readerMaySeeSubject(
            tx,
            context.workspaceId,
            memberId,
            subjectType,
            subjectId,
          ))
        ) {
          continue;
        }
        visible.push({
          id: row.id,
          reason: row.reason,
          channel: row.channel,
          readAt: row.readAt?.toISOString() ?? null,
          snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          subjectType,
          subjectId,
          rendered: row.activityKind
            ? renderActivity(row.activityKind, row.activityPayload ?? {})
            : null,
          ruleKey: row.ruleKey ?? null,
          watching:
            subjectType !== null &&
            subjectId !== null &&
            watched.has(`${subjectType}:${subjectId}`),
        });
      }
      return visible;
    });
  },
});

/**
 * Which of these subjects the member holds a live subscription to.
 *
 * One query for the page. A canceled subscription is not one: `mute` cancels
 * rather than deletes, so the row has to read the flag and not merely the
 * row's existence.
 */
async function watchedSubjects(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  subjects: readonly {
    subjectType: string | null;
    subjectId: string | null;
  }[],
): Promise<ReadonlySet<string>> {
  const pairs = subjects.filter(
    (subject): subject is { subjectType: string; subjectId: string } =>
      subject.subjectType !== null && subject.subjectId !== null,
  );
  if (pairs.length === 0) {
    return new Set();
  }
  const rows = await tx
    .select({
      subjectType: subscriptionLists.subjectType,
      subjectId: subscriptionLists.subjectId,
    })
    .from(subscriptions)
    .innerJoin(
      subscriptionLists,
      eq(subscriptionLists.id, subscriptions.listId),
    )
    .where(
      activeOnly(
        subscriptions,
        eq(subscriptions.workspaceId, workspaceId),
        eq(subscriptions.memberId, memberId),
        eq(subscriptions.canceled, false),
      ),
    );
  const held = new Set(
    rows.map((row) => `${row.subjectType}:${row.subjectId}`),
  );
  return new Set(
    pairs
      .map((subject) => `${subject.subjectType}:${subject.subjectId}`)
      .filter((key) => held.has(key)),
  );
}

/**
 * The number on the Inbox item in the sidebar (UIUX-PLAN §3, S-03, P6-G07a).
 *
 * Unread and not snoozed, which is the same set the screen's default view
 * lists, so the badge and the list cannot disagree. Snoozed rows are excluded
 * on purpose: a snooze that left the badge standing would be a snooze that did
 * nothing the reader asked for.
 *
 * **Not access-scoped, and it says so rather than pretending.** A count is a
 * number, not a subject, and scoping it would mean running the getter over
 * every unread row on every page load to decide a digit. What it can overstate
 * by is the rows whose subject the reader has since lost access to, which the
 * screen then does not list. The alternative is a badge that costs a page of
 * access checks on every navigation in the product.
 */
export const unreadNotificationCount = defineReadAction({
  name: "notifications.unreadCount",
  summary: "How many unread, unsnoozed notifications the member has.",
  input: z.object({}),
  output: z.object({ unread: z.number().int() }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (rawTx) => {
      const tx = rawTx as OperationTx;
      const memberId = await actingMember(
        tx,
        context.workspaceId,
        context.actor.userId,
      );
      if (!memberId) {
        return { unread: 0 };
      }
      const now = new Date();
      const [row] = await tx
        .select({ unread: count() })
        .from(notifications)
        .where(
          activeOnly(
            notifications,
            eq(notifications.workspaceId, context.workspaceId),
            eq(notifications.recipientMemberId, memberId),
            isNull(notifications.readAt),
            or(
              isNull(notifications.snoozedUntil),
              lte(notifications.snoozedUntil, now),
            ) as never,
          ),
        );
      return { unread: Number(row?.unread ?? 0) };
    });
  },
});

export const markNotificationRead = defineWriteAction({
  name: "notifications.markRead",
  summary: "Marks one of the signed-in member's own notifications read.",
  input: z.object({ notificationId: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  // A write, so at least edit — every active member holds it on the
  // workspace's own context through workspace_standard.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("not_found", "No such notification.");
      }
      const [updated] = await tx
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          activeOnly(
            notifications,
            eq(notifications.id, input.notificationId),
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.recipientMemberId, actor.memberId),
          ),
        )
        .returning({ id: notifications.id });
      if (!updated) {
        throw new OperationError("not_found", "No such notification.");
      }
      return {
        result: { id: updated.id },
        activity: {
          kind: "notification.read",
          subjectType: "notification",
          subjectId: updated.id,
        },
        audit: {
          action: "notifications.markRead",
          targetType: "notification",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const snoozeNotification = defineWriteAction({
  name: "notifications.snooze",
  summary: "Hides one of the signed-in member's own notifications until later.",
  input: z.object({
    notificationId: z.uuid(),
    untilMinutes: z.number().int().positive(),
  }),
  output: z.object({ id: z.uuid(), snoozedUntil: z.string() }),
  // Same reasoning as markNotificationRead above.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("not_found", "No such notification.");
      }
      const snoozedUntil = new Date(
        Date.now() + input.untilMinutes * 60 * 1000,
      );
      const [updated] = await tx
        .update(notifications)
        .set({ snoozedUntil, updatedAt: new Date() })
        .where(
          activeOnly(
            notifications,
            eq(notifications.id, input.notificationId),
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.recipientMemberId, actor.memberId),
          ),
        )
        .returning({ id: notifications.id });
      if (!updated) {
        throw new OperationError("not_found", "No such notification.");
      }
      return {
        result: { id: updated.id, snoozedUntil: snoozedUntil.toISOString() },
        activity: {
          kind: "notification.snoozed",
          subjectType: "notification",
          subjectId: updated.id,
        },
        audit: {
          action: "notifications.snooze",
          targetType: "notification",
          targetId: updated.id,
        },
      };
    },
  }),
});

const settingsOutput = z.object({
  memberId: z.uuid(),
  mentionImmediate: z.boolean(),
  batchWindowMinutes: z.number(),
  dailySummary: z.boolean(),
  dailySummaryTime: z.string(),
});

export const getNotificationSettings = defineReadAction({
  name: "notifications.getSettings",
  summary: "The signed-in member's own notification settings.",
  input: z.object({}),
  output: settingsOutput,
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const userId = context.actor.userId;
      if (!userId) {
        throw new OperationError("not_found", "No such member.");
      }
      const [member] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OperationError("not_found", "No such member.");
      }
      return getOrCreateNotificationSettings(
        tx,
        context.workspaceId,
        member.id,
      );
    });
  },
});

export const updateOwnNotificationSettings = defineWriteAction({
  name: "notifications.updateSettings",
  summary: "Updates the signed-in member's own notification settings.",
  input: z.object({
    mentionImmediate: z.boolean().optional(),
    batchWindowMinutes: z.number().int().positive().optional(),
    dailySummary: z.boolean().optional(),
    dailySummaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  }),
  output: settingsOutput,
  // A write, so at least edit — same reasoning as markNotificationRead above.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to update.");
      }
      const updated = await updateNotificationSettings(tx, {
        workspaceId,
        memberId: actor.memberId,
        ...input,
      });
      return {
        result: updated,
        activity: {
          kind: "notification_settings.updated",
          subjectType: "workspace_member",
          subjectId: actor.memberId,
        },
        audit: {
          action: "notifications.updateSettings",
          targetType: "workspace_member",
          targetId: actor.memberId,
        },
      };
    },
  }),
});

export const toggleSubscription = defineWriteAction({
  name: "subscriptions.toggle",
  summary: "Subscribes or unsubscribes the signed-in member from a subject.",
  input: z.object({
    subjectType: z.string().min(1),
    subjectId: z.uuid(),
    subscribe: z.boolean(),
  }),
  output: z.object({ subscribed: z.boolean() }),
  // Same reasoning as markNotificationRead above.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to subscribe.");
      }
      const listId = await ensureSubscriptionList(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      });
      if (input.subscribe) {
        await subscribeMember(tx, {
          workspaceId,
          listId,
          memberId: actor.memberId,
          reason: "role",
        });
      } else {
        await cancelSubscription(tx, {
          workspaceId,
          listId,
          memberId: actor.memberId,
        });
      }
      return {
        result: { subscribed: input.subscribe },
        activity: {
          kind: input.subscribe
            ? "subscription.added"
            : "subscription.canceled",
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
        audit: {
          action: "subscriptions.toggle",
          targetType: input.subjectType,
          targetId: input.subjectId,
        },
      };
    },
  }),
});

/**
 * A watcher an import found (P6-T04b).
 *
 * `subscriptions.toggle` subscribes the signed-in member and nobody else,
 * which is right for the product: choosing to follow something is a decision
 * only its owner makes. An import is restoring decisions other people already
 * made, in another system, sometimes years ago, so it needs to name the
 * member. Widening `toggle` with a member id would let anyone sign anyone up
 * to anything, which is the same trade `people.importMember` and `goals
 * .importCheckIn` refused before it.
 *
 * **No legacy key.** A subscription is unique per list and member, so a second
 * run of the same company finds the row already there. There is nothing to
 * recognise it by that the pair does not already say.
 *
 * A placeholder, an agent and a suspended member are silently not subscribed:
 * §7.2 says so and `subscribeMember` enforces it. The result reports which
 * happened, so the import can say how many watchers had nobody to notify
 * rather than claiming it wrote rows it did not.
 */
export const importWatcher = defineWriteAction({
  name: "subscriptions.importWatcher",
  summary: "Subscribes a member an import found watching something.",
  input: z.object({
    subjectType: z.string().min(1),
    subjectId: z.uuid(),
    /** The member who was watching in the source, not the one importing. */
    memberId: z.uuid(),
    reason: z.enum(NOTIFICATION_REASONS).default("role"),
  }),
  output: z.object({ subscribed: z.boolean() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const listId = await ensureSubscriptionList(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      });
      const before = await countSubscribers(tx, listId, input.memberId);
      await subscribeMember(tx, {
        workspaceId,
        listId,
        memberId: input.memberId,
        reason: input.reason,
      });
      const subscribed =
        before || (await countSubscribers(tx, listId, input.memberId));
      return {
        result: { subscribed },
        activity: {
          kind: "subscription.added",
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          payload: { imported: true, memberId: input.memberId },
        },
        audit: {
          action: "subscriptions.importWatcher",
          targetType: input.subjectType,
          targetId: input.subjectId,
          payload: { memberId: input.memberId },
        },
      };
    },
  }),
});

/** Whether this member already has a live row on this list. Read twice around
 * the write, because `subscribeMember` returns nothing and declining to
 * subscribe a placeholder looks identical to succeeding. */
async function countSubscribers(
  tx: OperationTx,
  listId: string,
  memberId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      activeOnly(
        subscriptions,
        eq(subscriptions.listId, listId),
        eq(subscriptions.memberId, memberId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Drains the batches whose window has closed (P6-G01b).
 *
 * **Nothing had ever called this path.** P2-T06 coalesced notifications into
 * batches correctly and its own comment said so plainly: "nothing dispatches a
 * `pending` batch or an unsent immediate row yet". Four months later nothing
 * did, so a member who chose a thirty-minute window received nothing rather
 * than one mail every half hour, and `renderDigest` had no caller outside the
 * package barrel. The gap audit recorded it as the second half of B-01.
 *
 * **A write action through the pipeline, not a bare function**, because it
 * changes rows and enqueues side effects and those two have to commit
 * together. The claim and the outbox row land in one transaction, so a crash
 * between them is impossible rather than merely unlikely.
 *
 * The scheduler host calls it per workspace as `system`, the same principal
 * the agent cadences run as. An administrator can call it by hand, which is
 * what makes the drain testable without a clock.
 */
export const drainNotificationBatches = defineWriteAction({
  name: "notifications.drainBatches",
  summary:
    "Claims every notification batch whose window has closed and enqueues its digest.",
  input: z.object({
    /** Defaults to the moment the request arrives. Overridden by tests. */
    now: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  output: z.object({
    claimed: z.number().int(),
    waiting: z.number().int(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const now = input.now ? new Date(input.now) : new Date();
      const drained = await claimDueBatches(tx as WorkspaceTx, {
        workspaceId,
        now,
        ...(input.limit ? { limit: input.limit } : {}),
      });
      return {
        result: { claimed: drained.claimed, waiting: drained.waiting },
        // The outbox rows the claim produced, written by the pipeline in this
        // same transaction. This is the only way a side effect leaves a write
        // path in this product.
        outbox: drained.outbox,
        activity: {
          kind: "notifications.drained",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { claimed: drained.claimed },
        },
        audit: {
          action: "notifications.drainBatches",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { claimed: drained.claimed },
        },
      };
    },
  }),
});
