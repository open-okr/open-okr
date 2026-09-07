/**
 * The monthly review's record (TECHNICAL-PLAN §4.7, METHOD.md §7.5, P4-T09).
 *
 * Two tables, both specified in the plan. A trend is the room's judgement
 * about one objective in one month. A decision is the artifact §7.5 says
 * survives the meeting, and it always names the goal or the key result it
 * affects.
 *
 * §7.5's other two items are not tables here. The dependency and risk log is a
 * read of P3-T09's alignment register, and a second copy would give a reader
 * two answers about one dependency. The resource or priority shifts are one
 * note per meeting, so they sit on the session.
 */
import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { cycles } from "./cycles.ts";
import { goals, keyResults } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/** §7.5's three trend values. Not a health band and not a progress signal. */
export const OBJECTIVE_TRENDS = ["improving", "flat", "declining"] as const;
export type ObjectiveTrend = (typeof OBJECTIVE_TRENDS)[number];

export const objectiveTrends = pgTable("objective_trends", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  /**
   * The first day of the month the review covers.
   *
   * Keyed on the month rather than the session, as the plan specifies: a space
   * that reschedules and holds two reviews in one March still has one March
   * opinion per objective.
   */
  month: date("month").notNull(),
  trend: text("trend", { enum: OBJECTIVE_TRENDS }).notNull(),
  authorMemberId: uuid("author_member_id")
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

export type ObjectiveTrendRow = typeof objectiveTrends.$inferSelect;

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /**
   * Stamped at the time rather than joined through the goal.
   *
   * `goals.moveToCycle` exists, so a derived cycle would let a goal moved into
   * the next quarter drag every past decision with it, and a decision taken in
   * Q1 would start reading as a Q2 decision.
   */
  cycleId: uuid("cycle_id").references(() => cycles.id, {
    onDelete: "set null",
  }),
  /**
   * Nullable, and today always set. A decision is recorded inside a monthly
   * review and nowhere else, and the column does not enforce that so opening a
   * second path later needs no rename across two releases.
   */
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id").references(() => keyResults.id, {
    onDelete: "cascade",
  }),
  /** §7.5 dates a decision to the day. Ordering within one falls to `created_at`. */
  at: date("at").notNull(),
  text: text("text").notNull(),
  authorMemberId: uuid("author_member_id")
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

export type Decision = typeof decisions.$inferSelect;
