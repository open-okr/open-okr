import {
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
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
  /** Position in this workspace's chain, from 1. */
  seq: bigint("seq", { mode: "number" }).notNull(),
  actorMemberId: uuid("actor_member_id").references(() => workspaceMembers.id),
  actorKind: text("actor_kind", {
    enum: ["human", "agent", "system", "operator"],
  }).notNull(),
  /** The registry action name, so a row resolves back to one contract. */
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  prevHash: text("prev_hash").notNull(),
  rowHash: text("row_hash").notNull(),
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
