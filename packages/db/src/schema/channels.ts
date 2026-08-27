import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Channels (AI-NATIVE-PLAN.md §5, TECHNICAL-PLAN §4.11, P5-T01b-a).
 *
 * Migration 0054 holds the row-level security policies and the four indexes
 * that make the constraints in `docs/design/p5-t00-channel-design.md` §2 the
 * only storable shapes.
 */

/** The four that need installing. Email is the instance's mail settings. */
export const CHANNEL_CONNECTION_PROVIDERS = [
  "slack",
  "teams",
  "whatsapp",
  "telegram",
] as const;

/** Every provider a message can travel over, email included. */
export const CHANNEL_MESSAGE_PROVIDERS = [
  "email",
  ...CHANNEL_CONNECTION_PROVIDERS,
] as const;

export const channelConnections = pgTable("channel_connections", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: CHANNEL_CONNECTION_PROVIDERS }).notNull(),
  state: text("state", { enum: ["connected", "error", "disabled"] })
    .notNull()
    .default("connected"),
  /** Envelope-encrypted. Never leaves the server, never enters a read action. */
  ciphertext: text("ciphertext").notNull(),
  dataKey: text("data_key").notNull(),
  keyId: text("key_id").notNull(),
  /** Not secret: a team id, a tenant id, a phone number id, a bot username. */
  config: jsonb("config").notNull().default({}),
  installedById: uuid("installed_by_id").references(() => workspaceMembers.id),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ChannelConnection = typeof channelConnections.$inferSelect;
export type ChannelConnectionProvider = ChannelConnection["provider"];

export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: CHANNEL_CONNECTION_PROVIDERS,
    }).notNull(),
    /** The provider's own identifier. What resolution reads. */
    externalId: text("external_id").notNull(),
    /** Display only. A handle is changeable, reusable and sometimes shared. */
    externalHandle: text("external_handle"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("channel_identities_external_idx").on(
      table.workspaceId,
      table.provider,
      table.externalId,
    ),
    uniqueIndex("channel_identities_member_idx").on(
      table.workspaceId,
      table.provider,
      table.memberId,
    ),
  ],
);

export type ChannelIdentity = typeof channelIdentities.$inferSelect;

export const channelMessages = pgTable(
  "channel_messages",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: CHANNEL_MESSAGE_PROVIDERS }).notNull(),
    direction: text("direction", { enum: ["out", "in"] }).notNull(),
    /** Null for a post to a space channel, which has no single recipient. */
    memberId: uuid("member_id").references(() => workspaceMembers.id, {
      onDelete: "set null",
    }),
    externalThreadId: text("external_thread_id"),
    payload: jsonb("payload").notNull().default({}),
    /** What makes an at-least-once relay safe to retry. */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", {
      enum: ["queued", "sent", "failed", "suppressed"],
    })
      .notNull()
      .default("queued"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("channel_messages_idempotency_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("channel_messages_member_idx").on(
      table.workspaceId,
      table.memberId,
      table.createdAt,
    ),
  ],
);

export type ChannelMessage = typeof channelMessages.$inferSelect;
