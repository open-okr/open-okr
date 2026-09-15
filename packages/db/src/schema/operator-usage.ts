import { bigint, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

/**
 * Per-tenant usage, as a snapshot above the tenant floor (P8-T03b).
 *
 * See migration 0086 for why this is a table rather than the view the
 * P8-T01b design first asked for: `force row level security` applies to the
 * table owner too, so no view and no security-definer function can count a
 * content table. A scheduled job opens each workspace properly, counts, and
 * writes one row here; the operator reads this and never a content table.
 *
 * Five numbers and two timestamps. No title, name or body from anything a
 * member wrote.
 */
export const operatorWorkspaceUsage = pgTable("operator_workspace_usage", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberCount: integer("member_count").notNull().default(0),
  goalCount: integer("goal_count").notNull().default(0),
  checkInCount: integer("check_in_count").notNull().default(0),
  storageBytes: bigint("storage_bytes", { mode: "number" })
    .notNull()
    .default(0),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  /** Shown beside the numbers, so a stale figure cannot read as a live one. */
  measuredAt: timestamp("measured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OperatorWorkspaceUsage = typeof operatorWorkspaceUsage.$inferSelect;
