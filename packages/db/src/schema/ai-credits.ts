import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One purchase of extra AI credits (docs/design/ai-credits.md §6). See migration 0147.
 *
 * A pack counts while `expires_at` is ahead of now. Nothing runs when it lapses: every
 * read compares the date.
 */
export const aiCreditPacks = pgTable(
  "ai_credit_packs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull(),
    purchasedUsd: numeric("purchased_usd", {
      precision: 14,
      scale: 6,
    }).notNull(),
    remainingUsd: numeric("remaining_usd", {
      precision: 14,
      scale: 6,
    }).notNull(),
    /** The provider's reference for the purchase: Stripe's checkout session. */
    purchaseRef: text("purchase_ref").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_credit_packs_purchase_unique").on(
      table.workspaceId,
      table.purchaseRef,
    ),
  ],
);
