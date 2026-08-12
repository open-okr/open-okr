import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { cycles } from "./cycles.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * The guided cycle workflow's evidence (TECHNICAL-PLAN §4.3, METHOD.md §2,
 * P3-T03).
 *
 * Every table here is what a phase is judged on. None of them holds a "phase
 * complete" boolean: §2.3 says the product computes completion from these rows,
 * and `packages/method`'s workflow evaluator is what does it.
 *
 * Indexes live in the migration, because several are partial.
 */

export const ISSUE_SOURCES = [
  "manual",
  "carry_forward",
  "process_health",
  "coach",
] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

export const cyclePackItems = pgTable("cycle_pack_items", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  /** 1 to 7, indexing the §2.6 list. */
  itemKey: smallint("item_key").notNull(),
  gathered: boolean("gathered").notNull().default(false),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cyclePriorScores = pgTable("cycle_prior_scores", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  /** No foreign key: key results arrive at P3-T04. */
  sourceKeyResultId: uuid("source_key_result_id"),
  text: text("text").notNull(),
  score: numeric("score", { precision: 3, scale: 2 }),
  note: text("note"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleBaselineHealth = pgTable("cycle_baseline_health", {
  cycleId: uuid("cycle_id")
    .primaryKey()
    .references(() => cycles.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  stable: jsonb("stable"),
  stableVersion: integer("stable_version"),
  declining: jsonb("declining"),
  decliningVersion: integer("declining_version"),
  businessAsUsual: jsonb("business_as_usual"),
  businessAsUsualVersion: integer("business_as_usual_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cyclePriorities = pgTable("cycle_priorities", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  successStatement: text("success_statement"),
  position: integer("position").notNull().default(0),
  /** No foreign key: goals arrive at P3-T04. */
  promotedToGoalId: uuid("promoted_to_goal_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleIssues = pgTable("cycle_issues", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** 1 to 5. The phase 2 surface reorders on it live. */
  impact: smallint("impact").notNull().default(3),
  source: text("source", { enum: ISSUE_SOURCES }).notNull().default("manual"),
  promotedToPriorityId: uuid("promoted_to_priority_id").references(
    () => cyclePriorities.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleRevalidations = pgTable("cycle_revalidations", {
  cycleId: uuid("cycle_id")
    .primaryKey()
    .references(() => cycles.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  holds: boolean("holds").notNull().default(false),
  changed: boolean("changed").notNull().default(false),
  changeNote: text("change_note"),
  focusNote: text("focus_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleFocusKeyResults = pgTable("cycle_focus_key_results", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  /** No foreign key: key results arrive at P3-T04. */
  annualKeyResultId: uuid("annual_key_result_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleCapacityNotes = pgTable("cycle_capacity_notes", {
  cycleId: uuid("cycle_id")
    .primaryKey()
    .references(() => cycles.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cuts: jsonb("cuts"),
  cutsVersion: integer("cuts_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleGateState = pgTable("cycle_gate_state", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  /** 1 to 6, as METHOD.md §4.5 lists them. */
  gateKey: smallint("gate_key").notNull(),
  passed: boolean("passed").notNull().default(false),
  /** False when an input does not exist yet. Not the same as failing. */
  evaluable: boolean("evaluable").notNull().default(true),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  detail: jsonb("detail")
    .$type<{ missing?: string[]; blocked?: string }>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const cycleCalibrations = pgTable("cycle_calibrations", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  used: boolean("used").notNull().default(true),
  reason: text("reason").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  authorMemberId: uuid("author_member_id").references(
    () => workspaceMembers.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type CyclePackItem = typeof cyclePackItems.$inferSelect;
export type CyclePriorScore = typeof cyclePriorScores.$inferSelect;
export type CycleBaselineHealth = typeof cycleBaselineHealth.$inferSelect;
export type CyclePriority = typeof cyclePriorities.$inferSelect;
export type CycleIssue = typeof cycleIssues.$inferSelect;
export type CycleRevalidation = typeof cycleRevalidations.$inferSelect;
export type CycleFocusKeyResult = typeof cycleFocusKeyResults.$inferSelect;
export type CycleCapacityNote = typeof cycleCapacityNotes.$inferSelect;
export type CycleGateStateRow = typeof cycleGateState.$inferSelect;
export type CycleCalibration = typeof cycleCalibrations.$inferSelect;
