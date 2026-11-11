import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

/**
 * A person's request to delete their own account, and the ledger its run
 * resumes from (docs/design/account-deletion.md §6, plan 0.8.0 Y7).
 *
 * Above the tenant floor, beside `users` and `sessions`: no `workspace_id`
 * and no soft delete. The person reads their own row through the user
 * setting; every write and the scheduler's reads go through the instance-admin
 * flag. See migration 0167 for the policies.
 */
export const accountDeletions = pgTable("account_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  runsAt: timestamp("runs_at", { withTimezone: true }).notNull(),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason", { enum: ["signed_in", "refused"] }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  workspacesDone: uuid("workspaces_done").array().notNull().default([]),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export type AccountDeletion = typeof accountDeletions.$inferSelect;
