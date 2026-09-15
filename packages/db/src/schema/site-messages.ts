import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

/**
 * Site messages, and who has dismissed one (P8-T03c).
 *
 * What the vendor says to everybody, or to a named set of workspaces. Above
 * the tenant floor, because one row is shown in many workspaces and a copy
 * per workspace would be the same sentence written a thousand times.
 *
 * See migration 0088 for the policies and for the two places this corrects
 * the P8-T01b design: the body is plain text rather than editor JSON, and a
 * dismissal is keyed on the user rather than on a member.
 */
export const SITE_MESSAGE_LEVELS = ["info", "warn", "bad"] as const;

export type SiteMessageLevel = (typeof SITE_MESSAGE_LEVELS)[number];

export const siteMessages = pgTable("site_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  body: text("body").notNull(),
  level: text("level", { enum: SITE_MESSAGE_LEVELS }).notNull().default("info"),
  /** Both required. A message with no end is a banner everybody ignores. */
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** Null is everybody. A list names the workspaces it reaches. */
  targetWorkspaceIds: uuid("target_workspace_ids").array(),
  dismissible: boolean("dismissible").notNull().default(true),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const siteMessageDismissals = pgTable(
  "site_message_dismissals",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => siteMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);

export type SiteMessage = typeof siteMessages.$inferSelect;
