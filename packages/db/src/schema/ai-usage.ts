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
 * Usage metering and budgets (AI-NATIVE-PLAN.md §4, screen S-37, P2-T16).
 * See migration 0017 for why `ai_usage_events` carries no `deleted_at` and
 * why `agent_id` has no foreign key yet.
 */
export const USAGE_SOURCES = [
  "copilot",
  "mcp",
  "assist",
  "agent",
  "rest",
  "channel",
] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").references(() => workspaceMembers.id),
  agentId: uuid("agent_id"),
  featureKey: text("feature_key"),
  source: text("source", { enum: USAGE_SOURCES }).notNull(),
  provider: text("provider", { enum: AI_PROVIDER_KINDS }).notNull(),
  modelId: text("model_id").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cost: numeric("cost", { precision: 12, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms"),
  status: text("status", { enum: ["ok", "error", "blocked"] })
    .notNull()
    .default("ok"),
  flagged: boolean("flagged").notNull().default(false),
  flaggedReason: text("flagged_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AIUsageEvent = typeof aiUsageEvents.$inferSelect;
export type UsageStatus = AIUsageEvent["status"];

export const BUDGET_SCOPES = ["user", "agent", "workspace"] as const;
export const BUDGET_METRICS = ["tokens", "cost", "calls"] as const;
export const BUDGET_PERIODS = ["day", "month"] as const;

export type BudgetScope = (typeof BUDGET_SCOPES)[number];
export type BudgetMetric = (typeof BUDGET_METRICS)[number];
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const aiBudgets = pgTable("ai_budgets", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: BUDGET_SCOPES }).notNull(),
  /** Null for `scope: "workspace"`; a member or agent id otherwise. */
  scopeRef: uuid("scope_ref"),
  metric: text("metric", { enum: BUDGET_METRICS }).notNull(),
  period: text("period", { enum: BUDGET_PERIODS }).notNull(),
  limitValue: numeric("limit_value", { precision: 14, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AIBudget = typeof aiBudgets.$inferSelect;
