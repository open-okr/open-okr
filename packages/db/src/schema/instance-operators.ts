import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

/**
 * The cloud operator (P8-T03a).
 *
 * Design: `docs/design/p8-t01b-operator-console.md`. An operator is a `users`
 * row with a grant, not a `workspace_members` row: they are a member of
 * nothing, and giving them one in every workspace is the ambient authority
 * CLAUDE.md's least-privilege rule forbids.
 *
 * Above the tenant floor, so no `workspace_id` and no soft delete. Revocation
 * is a stamp kept forever, because the trail of who could see what and when
 * is the point of the table.
 *
 * See migration 0084 for the policies, the `app_is_live_operator()` function
 * every operator policy calls, and the usage view.
 */
export const instanceOperators = pgTable("instance_operators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Never null and never self. A check constraint enforces the second. */
  grantedByUserId: text("granted_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  note: text("note"),
});

export type InstanceOperator = typeof instanceOperators.$inferSelect;
