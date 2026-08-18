import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Per-rule nudge configuration (P4-T04b, TECHNICAL-PLAN.md §4 line 221).
 *
 * One row per rule a workspace has changed its mind about. **The absence of a
 * row is the canon default**, which is what §4.14 means by nothing needing
 * configuration before the product works: a fresh workspace has no rows here
 * and every rule in the §6.4 catalogue is enabled, on the member's primary
 * channel, with §11's ladder.
 *
 * Deliberately not seeded with forty-four rows. Seeding would make this table
 * the catalogue's second home, and then adding a trigger to `packages/method`
 * would need a data change in every workspace before it could ever fire.
 */
export const nudgeRules = pgTable(
  "nudge_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Resolves to the §6.4 catalogue, like `nudges.rule_key`. */
    ruleKey: text("rule_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Overrides the member's primary channel for this rule only.
     *
     * Null means the member's own choice stands, which is the default and the
     * respectful answer.
     */
    channelOverride: text("channel_override"),
    /**
     * A workspace ladder for this rule, replacing §11's.
     *
     * Null is the canon ladder, and that is what almost every workspace should
     * leave it at: §11 carries the argument for each number beside it.
     */
    escalationLadder:
      jsonb("escalation_ladder").$type<Record<string, number>>(),
    /**
     * Whether this rule still speaks while workspace quiet mode is on.
     *
     * §6.3 puts escalations through quiet mode unconditionally; this is how a
     * workspace names which other rules also earn that.
     */
    quietModeExempt: boolean("quiet_mode_exempt").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Two rows would let a workspace disagree with itself and make the read
    // order-dependent.
    unique("nudge_rules_unique_per_workspace").on(
      table.workspaceId,
      table.ruleKey,
    ),
  ],
);

export type NudgeRule = typeof nudgeRules.$inferSelect;
