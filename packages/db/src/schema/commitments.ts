/**
 * Weekly commitments (TECHNICAL-PLAN §4, METHOD.md §7.2 step 3, P4-T08).
 *
 * Set in one week's session, closed in the next. Each commitment has an
 * owner and an optional link to the key result it serves.
 */
import {
  boolean,
  date,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { keyResults } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const commitments = pgTable("commitments", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  text: text("text").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => workspaceMembers.id),
  keyResultId: uuid("key_result_id").references(() => keyResults.id, {
    onDelete: "set null",
  }),
  delivered: boolean("delivered"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Commitment = typeof commitments.$inferSelect;
