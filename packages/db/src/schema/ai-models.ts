import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { AI_PROVIDER_KINDS } from "./ai.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Model catalogue, tier routing, feature settings and the prompt registry
 * (AI-NATIVE-PLAN.md §3.4, §4, §7, P2-T15). See migration 0016 for why
 * `ai_models` holds only custom entries, and the seeded catalogue and
 * default prompts are code rather than rows.
 */
export const MODEL_TIERS = ["fast", "balanced", "deep", "embed"] as const;

export const aiModels = pgTable("ai_models", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: AI_PROVIDER_KINDS }).notNull(),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  contextWindow: integer("context_window").notNull(),
  costInPerMillion: numeric("cost_in_per_million", {
    precision: 10,
    scale: 4,
  })
    .notNull()
    .default("0"),
  costOutPerMillion: numeric("cost_out_per_million", {
    precision: 10,
    scale: 4,
  })
    .notNull()
    .default("0"),
  supportsTools: boolean("supports_tools").notNull().default(false),
  supportsVision: boolean("supports_vision").notNull().default(false),
  supportsJsonMode: boolean("supports_json_mode").notNull().default(false),
  supportsStreaming: boolean("supports_streaming").notNull().default(false),
  embeddingDimensions: integer("embedding_dimensions"),
  tiers: text("tiers", { enum: MODEL_TIERS }).array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AIModel = typeof aiModels.$inferSelect;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const aiModelPolicies = pgTable("ai_model_policies", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  tier: text("tier", { enum: MODEL_TIERS }).notNull(),
  provider: text("provider", { enum: AI_PROVIDER_KINDS }).notNull(),
  modelId: text("model_id").notNull(),
  temperature: numeric("temperature", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AIModelPolicy = typeof aiModelPolicies.$inferSelect;

export const aiFeatureSettings = pgTable("ai_feature_settings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  tierOverride: text("tier_override", { enum: MODEL_TIERS }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AIFeatureSetting = typeof aiFeatureSettings.$inferSelect;

export const aiPrompts = pgTable("ai_prompts", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  promptKey: text("prompt_key").notNull(),
  version: integer("version").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  createdByMemberId: uuid("created_by_member_id").references(
    () => workspaceMembers.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AIPrompt = typeof aiPrompts.$inferSelect;
