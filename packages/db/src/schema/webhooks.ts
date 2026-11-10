import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Outbound webhooks and their delivery log (migration 0164,
 * docs/design/outbound-webhooks.md, plan 0.7.0 D5).
 *
 * The secret columns are envelope-encrypted and read by the relay alone, at
 * the moment it signs (W6). No read action selects them. The four checks in
 * the migration keep each sealed secret whole and keep a hook that is on from
 * having no secret, which is the state an archive import leaves one in (W14).
 */

/** Why a hook is off. Null while it is on. */
export const WEBHOOK_OFF_REASONS = ["manual", "failures", "imported"] as const;

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** Public event names (W3), never an activity kind. */
  events: text("events").array().notNull(),
  spaceId: uuid("space_id").references(() => spaces.id, {
    onDelete: "cascade",
  }),
  ownerMemberId: uuid("owner_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  createdByMemberId: uuid("created_by_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  enabled: boolean("enabled").notNull().default(true),
  offReason: text("off_reason", { enum: WEBHOOK_OFF_REASONS }),
  secretCiphertext: text("secret_ciphertext"),
  secretDataKey: text("secret_data_key"),
  secretKeyId: text("secret_key_id"),
  previousSecretCiphertext: text("previous_secret_ciphertext"),
  previousSecretDataKey: text("previous_secret_data_key"),
  previousSecretKeyId: text("previous_secret_key_id"),
  previousSecretExpiresAt: timestamp("previous_secret_expires_at", {
    withTimezone: true,
  }),
  secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  turnedOffAt: timestamp("turned_off_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** What one attempt came to (W10). */
export const WEBHOOK_DELIVERY_OUTCOMES = [
  "delivered",
  "failed",
  "refused",
  "withheld",
] as const;

/**
 * One row per attempt. No `deleted_at`: an operational log purged by age, as
 * the migration's marker says, and never a body or a response header.
 */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  webhookId: uuid("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  eventId: text("event_id").notNull(),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  checkInId: uuid("check_in_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  attempt: integer("attempt").notNull(),
  outcome: text("outcome", { enum: WEBHOOK_DELIVERY_OUTCOMES }).notNull(),
  statusCode: integer("status_code"),
  durationMs: integer("duration_ms"),
  reason: text("reason"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
