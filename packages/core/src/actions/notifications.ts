/**
 * Notification and subscription actions (TECHNICAL-PLAN §4.10, §4.11,
 * P2-T06). The in-app inbox: list, mark read, snooze. Settings: read and
 * update the member's own routing. Subscriptions: a self-service toggle,
 * which is what "mute" means here — canceling the subscription, the same
 * primitive `reconcileMentions` uses to remove one on edit.
 */
import {
  activeOnly,
  notifications,
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
import { OperationError } from "../operations/operation.ts";
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
  access: ACCESS_LEVELS.view,
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
  access: ACCESS_LEVELS.view,
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
  access: ACCESS_LEVELS.view,
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
  access: ACCESS_LEVELS.view,
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
