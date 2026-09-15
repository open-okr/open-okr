import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Time-boxed, customer-granted operator access (P8-T04a).
 *
 * Design: `docs/design/p8-t01b-support-access.md`. See migration 0089 for the
 * policies, the one-live-session index, and the two check constraints that
 * stop a grant half-applying.
 *
 * **The session is a binding, not a bypass.** `member_id` names a real
 * `guest` member row created through the one member-provisioning funnel, so
 * `can()` answers for an operator exactly as it answers for anybody else.
 */
export const OPERATOR_SESSION_END_REASONS = [
  "expired",
  "revoked",
  "finished",
  "refused",
] as const;

export type OperatorSessionEndReason =
  (typeof OPERATOR_SESSION_END_REASONS)[number];

export const operatorSessions = pgTable("operator_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  operatorUserId: text("operator_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  /** Separate from `grantedAt`: the gap between them is the decision. */
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  grantedByMemberId: uuid("granted_by_member_id").references(
    () => workspaceMembers.id,
    { onDelete: "set null" },
  ),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedReason: text("ended_reason", { enum: OPERATOR_SESSION_END_REASONS }),
  /** The guest member row the grant created. */
  memberId: uuid("member_id").references(() => workspaceMembers.id, {
    onDelete: "set null",
  }),
  /** An `ACCESS_LEVELS` value. `full` is never offered. */
  level: integer("level").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type OperatorSession = typeof operatorSessions.$inferSelect;
