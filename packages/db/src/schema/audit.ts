import {
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { users } from "./auth.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * The audit trail and the activity feed's table (TECHNICAL-PLAN §4.1, §4.11).
 *
 * Both are written by the Operation pipeline inside the mutating transaction,
 * never on their own. Neither carries `created_at` or `updated_at`: an audit
 * row and an activity row are facts about one instant, recorded in `at`, and
 * they are never updated.
 */

/** Who acted. `system` covers work with no member behind it, like bootstrap. */
export type ActorKind = "human" | "agent" | "system" | "operator";

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  /**
   * Position in the workspace chain, filled by the chainer rather than by
   * the write (P7-T02a). Null means recorded and not yet chained.
   */
  seq: bigint("seq", { mode: "number" }),
  actorMemberId: uuid("actor_member_id").references(() => workspaceMembers.id),
  /**
   * The cloud operator who acted, when `actorKind` is `operator` (P8-T03b).
   * Null for every other kind. An operator is not a member of the workspace
   * they act on, so `actorMemberId` is null for them and this is what the
   * customer sees instead of an empty actor.
   */
  actorOperatorUserId: text("actor_operator_user_id").references(
    () => users.id,
    { onDelete: "set null" },
  ),
  actorKind: text("actor_kind", {
    enum: ["human", "agent", "system", "operator"],
  }).notNull(),
  /** The registry action name, so a row resolves back to one contract. */
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  prevHash: text("prev_hash"),
  rowHash: text("row_hash"),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  actorMemberId: uuid("actor_member_id").references(() => workspaceMembers.id, {
    onDelete: "set null",
  }),
  actorKind: text("actor_kind", {
    enum: ["human", "agent", "system", "operator"],
  }).notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  spaceId: uuid("space_id"),
  contextId: uuid("context_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEvent = typeof auditEvents.$inferSelect;
export type Activity = typeof activities.$inferSelect;
