/**
 * Blockers (TECHNICAL-PLAN §4, METHOD.md §7.3, P4-T07c).
 *
 * Opened during the weekly session's diagnose step for every key result
 * with confidence below the low boundary. The 24-hour clock starts on save.
 */
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { goals, keyResults } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const BLOCKER_TYPES = [
  "resource",
  "dependency",
  "clarity",
  "priority_conflict",
  "external",
] as const;
export type BlockerType = (typeof BLOCKER_TYPES)[number];

export const BLOCKER_SOURCES = [
  "session",
  "manual",
  "channel",
  "agent",
] as const;
export type BlockerSource = (typeof BLOCKER_SOURCES)[number];

export const blockers = pgTable("blockers", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id").references(() => keyResults.id, {
    onDelete: "cascade",
  }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
  type: text("type", { enum: BLOCKER_TYPES }).notNull(),
  description: text("description"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => workspaceMembers.id),
  nextAction: text("next_action").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  escalatedToId: uuid("escalated_to_id").references(() => workspaceMembers.id),
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  source: text("source", { enum: BLOCKER_SOURCES })
    .notNull()
    .default("session"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Blocker = typeof blockers.$inferSelect;
