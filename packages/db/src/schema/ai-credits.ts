import { date, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

/**
 * A workspace's AI credit balance (docs/design/ai-credits.md §4). See migration 0146.
 *
 * Amounts are model cost in US dollars, whatever currency a provider sells in. One
 * row per workspace, so the check before every AI call is one locked read.
 */
export const aiCreditBalances = pgTable("ai_credit_balances", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  usedUsd: numeric("used_usd", { precision: 14, scale: 6 })
    .notNull()
    .default("0"),
  agentUsedUsd: numeric("agent_used_usd", { precision: 14, scale: 6 })
    .notNull()
    .default("0"),
  /** Survives a new month, because somebody paid for it. */
  purchasedUsd: numeric("purchased_usd", { precision: 14, scale: 6 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
