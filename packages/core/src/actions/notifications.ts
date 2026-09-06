/**
 * Notification and subscription actions (TECHNICAL-PLAN §4.10, §4.11,
 * P2-T06). The in-app inbox: list, mark read, snooze. Settings: read and
 * update the member's own routing. Subscriptions: a self-service toggle,
 * which is what "mute" means here — canceling the subscription, the same
 * primitive `reconcileMentions` uses to remove one on edit.
 */
import {
  activeOnly,
  NOTIFICATION_REASONS,
  notifications,
  subscriptions,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  getOrCreateNotificationSettings,
  updateNotificationSettings,
} from "../notifications/settings.ts";
import {
  cancelSubscription,
  ensureSubscriptionList,
  subscribeMember,
} from "../notifications/subscriptions.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const notificationRow = z.object({
  id: z.uuid(),
  reason: z.enum(["invited", "joined", "mentioned", "role"]),
  channel: z.string(),
  readAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string(),
});

export const listNotifications = defineReadAction({
  name: "notifications.list",
  summary: "The signed-in member's own inbox.",
  input: z.object({ unreadOnly: z.boolean().optional() }),
  output: z.array(notificationRow),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const userId = context.actor.userId;
      if (!userId) {
        return [];
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
        return [];
      }

      const now = new Date();
      const conditions = [
        eq(notifications.recipientMemberId, member.id),
        or(
          isNull(notifications.snoozedUntil),
          lte(notifications.snoozedUntil, now),
        ),
      ];
      if (input.unreadOnly) {
        conditions.push(isNull(notifications.readAt));
      }

      const rows = await tx
        .select({
          id: notifications.id,
          reason: notifications.reason,
          channel: notifications.channel,
          readAt: notifications.readAt,
          snoozedUntil: notifications.snoozedUntil,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(
          activeOnly(
            notifications,
            eq(notifications.workspaceId, context.workspaceId),
            and(...conditions),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(100);

      return rows.map((row) => ({
        ...row,
        readAt: row.readAt?.toISOString() ?? null,
        snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }));
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
