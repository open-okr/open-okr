/**
 * Learnings, next-cycle drafts and the review's actions (DATABASE.md §11,
 * METHOD.md §8.9 and §8.1 stage 11, P4-T11c-b).
 *
 * Stage ten turns what happened into what the team now knows. Stage eleven gives
 * every action a name and a date, which §8.1 says is the difference between an
 * action and a wish.
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
import { cycles } from "./cycles.ts";
import { goals } from "./goals.ts";
import { retroNotes } from "./retros.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/** Where a learning came from. §8.9 promotes the top retro themes. */
export const LEARNING_SOURCES = ["manual", "retro_theme", "coach"] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

export const learnings = pgTable("learnings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** Nullable: every learning belongs to a cycle, not every one to a session. */
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** §8.9's "mark the ones to carry forward". */
  carryForward: boolean("carry_forward").notNull().default(false),
  source: text("source", { enum: LEARNING_SOURCES })
    .notNull()
    .default("manual"),
  /** The note this was promoted from, so the same theme cannot be promoted twice. */
  retroNoteId: uuid("retro_note_id").references(() => retroNotes.id, {
    onDelete: "set null",
  }),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => workspaceMembers.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Learning = typeof learnings.$inferSelect;

export const nextCycleDrafts = pgTable("next_cycle_drafts", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  why: text("why").notNull(),
  /** Set when the draft became a real objective. A draft is a candidate. */
  promotedToGoalId: uuid("promoted_to_goal_id").references(() => goals.id, {
    onDelete: "set null",
  }),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => workspaceMembers.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type NextCycleDraft = typeof nextCycleDrafts.$inferSelect;

export const reviewActions = pgTable("review_actions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  what: text("what").notNull(),
  /**
   * Both required, correcting TECHNICAL-PLAN §4's `owner_id?` and `due_on?`.
   *
   * METHOD.md §8.1 stage 11: "Every action has a name and a date, or it is a
   * wish." The canon is unambiguous and the task's own test plan asks for the
   * refusal, so nullable columns would make the product able to store the exact
   * thing the stage exists to prevent.
   */
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => workspaceMembers.id),
  dueOn: date("due_on").notNull(),
  done: boolean("done").notNull().default(false),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => workspaceMembers.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ReviewAction = typeof reviewActions.$inferSelect;
