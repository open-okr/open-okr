// An acknowledgement obligation is not an invitation, a join, a mention or a
// role change (P3-T07). `review` is the reviewer's own obligation, which the
// review inbox filters on; `check_in` is the fan-out to subscribers.
export const NOTIFICATION_REASONS = [
  "invited",
  "joined",
  "mentioned",
  "role",
  "review",
  "check_in",
] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { activities } from "./audit.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Subscriptions and the notification spine (TECHNICAL-PLAN §4.10, §4.11,
 * P2-T06). See migration 0013 for the reasoning behind each column.
 */

export const subscriptionLists = pgTable("subscription_lists", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  sendToEveryone: boolean("send_to_everyone").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  listId: uuid("list_id")
    .notNull()
    .references(() => subscriptionLists.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  reason: text("reason", {
    enum: NOTIFICATION_REASONS,
  }).notNull(),
  canceled: boolean("canceled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export interface NotificationRouting {
  readonly [reason: string]: string | undefined;
}

export const notificationSettings = pgTable("notification_settings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  routing: jsonb("routing").$type<NotificationRouting>().notNull().default({}),
  mentionImmediate: boolean("mention_immediate").notNull().default(true),
  batchWindowMinutes: integer("batch_window_minutes").notNull().default(30),
  dailySummary: boolean("daily_summary").notNull().default(true),
  dailySummaryTime: text("daily_summary_time").notNull().default("08:00"),
  quietHours: jsonb("quiet_hours").$type<{
    readonly start: string;
    readonly end: string;
  } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const notificationBatches = pgTable("notification_batches", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] })
    .notNull()
    .default("pending"),
  windowMinutes: integer("window_minutes").notNull(),
  sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  recipientMemberId: uuid("recipient_member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  activityId: uuid("activity_id").references(() => activities.id),
  /** No foreign key: nudges are P4-T04. */
  nudgeId: uuid("nudge_id"),
  batchId: uuid("batch_id").references(() => notificationBatches.id, {
    onDelete: "set null",
  }),
  reason: text("reason", {
    enum: NOTIFICATION_REASONS,
  }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  channel: text("channel").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SubscriptionList = typeof subscriptionLists.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionReason = Subscription["reason"];
export type NotificationSettingsRow = typeof notificationSettings.$inferSelect;
export type NotificationBatch = typeof notificationBatches.$inferSelect;
export type NotificationBatchStatus = NotificationBatch["status"];
export type Notification = typeof notifications.$inferSelect;
