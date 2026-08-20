/**
 * Rhythm streaks (TECHNICAL-PLAN §4, METHOD.md §7.4, P4-T08).
 *
 * One row per space. Consecutive weeks a space held its check-in. A skipped
 * week or a missed deadline breaks it.
 *
 * openokr:hard-delete: a streak is derived, never authored. Deleting a space
 * takes its streak.
 */
import {
  date,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { spaces } from "./spaces.ts";
import { workspaces } from "./workspaces.ts";

export const streaks = pgTable("streaks", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  currentWeeks: integer("current_weeks").notNull().default(0),
  longestWeeks: integer("longest_weeks").notNull().default(0),
  lastSessionWeek: date("last_session_week"),
  history: jsonb("history").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Streak = typeof streaks.$inferSelect;
