import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * AI provider configuration and credentials (AI-NATIVE-PLAN.md §3.3, §7,
 * P2-T14). See migration 0015 for the RLS policies and the two unique
 * indexes that make one workspace-level and one personal-per-member
 * credential per provider the only shapes storable.
 */
export const AI_PROVIDER_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "ollama",
  "openai-compatible",
] as const;

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: AI_PROVIDER_KINDS }).notNull(),
  baseUrl: text("base_url"),
  enabled: boolean("enabled").notNull().default(false),
  allowUserKeys: boolean("allow_user_keys").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AIProviderConfig = typeof aiProviders.$inferSelect;
export type AIProviderKind = AIProviderConfig["provider"];

export const aiCredentials = pgTable("ai_credentials", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: AI_PROVIDER_KINDS }).notNull(),
  /** Null: the workspace's own key. Set: one member's personal key. */
  ownerMemberId: uuid("owner_member_id").references(() => workspaceMembers.id),
  ciphertext: text("ciphertext").notNull(),
  dataKey: text("data_key").notNull(),
  keyId: text("key_id").notNull(),
  keyHint: text("key_hint").notNull(),
  status: text("status", {
    enum: ["unverified", "verified", "invalid"],
  })
    .notNull()
    .default("unverified"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AICredential = typeof aiCredentials.$inferSelect;
export type AICredentialStatus = AICredential["status"];
