import {
  boolean,
  date,
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
import { annualStrategies, cycles, GOAL_LEVELS } from "./cycles.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Goals, key results, the value history and the close retrospective
 * (TECHNICAL-PLAN §4.4, METHOD.md §2.5, §4, P3-T04).
 *
 * Five invariants live in the migration as check constraints rather than here:
 * one parent pointer at most, a cycle or a timeframe but never both, an owner
 * that matches its kind, a close that carries its outcome and decision, and a
 * closed goal whose health is one of the two closed outcomes. Drizzle cannot
 * express them, and an invariant that only application code holds is one a
 * single forgotten path can break.
 *
 * `kpi_id`, `last_check_in_id` and `key_result_values.check_in_id` point at
 * tables that arrive later (P3-T12, P3-T07). Plain uuid columns until then, the
 * same way this table's own id waited inside `cycle_prior_scores`.
 *
 * Indexes live in the migration: most are partial on `deleted_at is null`, and a
 * Drizzle declaration that dropped the predicate would describe an index the
 * database does not have.
 */

// `GOAL_LEVELS` is not redeclared here. It arrived with `cycles.levels` at
// P3-T02, which is the list of levels a cycle asks for OKRs at, and a goal's own
// level has to be from that same list or the two would drift.

export const GOAL_OWNER_KINDS = ["workspace", "space", "member"] as const;
export type GoalOwnerKind = (typeof GOAL_OWNER_KINDS)[number];

/** The seven §4.1 values. The last two are outcomes, not live statuses. */
export const GOAL_HEALTH = [
  "pending",
  "on_track",
  "caution",
  "off_track",
  "outdated",
  "achieved",
  "missed",
] as const;
export type GoalHealth = (typeof GOAL_HEALTH)[number];

/**
 * METHOD.md §2.8 (P9-T11b-a). The same two words as the method's `OkrKind`,
 * spelled here because this package does not depend on `packages/method`,
 * and the column's check constraint names them too.
 */
export const GOAL_KINDS = ["committed", "aspirational"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_SUCCESS_STATUSES = ["achieved", "missed"] as const;
export type GoalSuccessStatus = (typeof GOAL_SUCCESS_STATUSES)[number];

/** METHOD.md §8.8, on every closed goal. */
export const GOAL_CLOSE_DECISIONS = ["keep", "modify", "abandon"] as const;
export type GoalCloseDecision = (typeof GOAL_CLOSE_DECISIONS)[number];

/**
 * METHOD.md §2.10 (P9-T12b). The same four words as the method's
 * `KEY_RESULT_KINDS`, spelled here for the reason `GOAL_KINDS` is.
 */
export const KEY_RESULT_KINDS = [
  "metric",
  "maintain",
  "milestone",
  "baseline",
] as const;
export type KeyResultKind = (typeof KEY_RESULT_KINDS)[number];

export const KEY_RESULT_DIRECTIONS = [
  "increase",
  "reduce",
  "maintain",
  "move",
] as const;
export type KeyResultDirection = (typeof KEY_RESULT_DIRECTIONS)[number];

export const INDICATOR_TYPES = ["leading", "lagging"] as const;
export type IndicatorType = (typeof INDICATOR_TYPES)[number];

/** METHOD.md §5.5's align-and-commit verdict. Publish gate 5 reads it. */
export const CAPACITY_VERDICTS = ["fits", "tight", "exceeds"] as const;
export type CapacityVerdict = (typeof CAPACITY_VERDICTS)[number];

export const VALUE_SOURCES = [
  "manual",
  "check_in",
  "kpi",
  "import",
  "agent",
] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

/** A contextual goal's own window, for a goal that sits in no cycle. */
export interface GoalTimeframe {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly label?: string;
}

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: jsonb("description"),
  descriptionVersion: integer("description_version"),
  cycleId: uuid("cycle_id").references(() => cycles.id, {
    onDelete: "set null",
  }),
  timeframe: jsonb("timeframe").$type<GoalTimeframe>(),
  level: text("level", { enum: GOAL_LEVELS }).notNull(),
  /** Committed or aspirational (METHOD.md §2.8). Aspirational by default. */
  kind: text("kind", { enum: GOAL_KINDS }).notNull().default("aspirational"),
  ownerKind: text("owner_kind", { enum: GOAL_OWNER_KINDS }).notNull(),
  spaceId: uuid("space_id").references(() => spaces.id, {
    onDelete: "set null",
  }),
  memberId: uuid("member_id").references(() => workspaceMembers.id, {
    onDelete: "set null",
  }),
  championId: uuid("champion_id")
    .notNull()
    .references(() => workspaceMembers.id),
  /**
   * Optional since P9-T04 (METHOD.md §2.5): the practice decides whether a
   * goal needs one, and a goal without one owes no acknowledgement.
   */
  reviewerId: uuid("reviewer_id").references(() => workspaceMembers.id),
  /**
   * The §2.1 annual strategy this objective serves (P6-G14b).
   *
   * Null for a quarterly objective, which serves its parent objective rather
   * than a strategy directly: the strategy is the annual layer.
   */
  strategyId: uuid("strategy_id").references(() => annualStrategies.id, {
    onDelete: "set null",
  }),
  parentGoalId: uuid("parent_goal_id"),
  parentKeyResultId: uuid("parent_key_result_id"),
  /** `numeric` arrives from the driver as a string. Read it through a parse. */
  weight: numeric("weight").notNull().default("1"),
  checkInFrequency: text("check_in_frequency", {
    enum: ["daily", "weekly", "biweekly", "monthly"],
  }),
  nextCheckInAt: timestamp("next_check_in_at", { withTimezone: true }),
  lastCheckInId: uuid("last_check_in_id"),
  contributionStatement: text("contribution_statement"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedById: uuid("closed_by_id").references(() => workspaceMembers.id),
  successStatus: text("success_status", { enum: GOAL_SUCCESS_STATUSES }),
  closeDecision: text("close_decision", { enum: GOAL_CLOSE_DECISIONS }),
  closeReason: text("close_reason"),
  progressPct: numeric("progress_pct").notNull().default("0"),
  health: text("health", { enum: GOAL_HEALTH }).notNull().default("pending"),
  qualityScore: smallint("quality_score"),
  qualityFlags: jsonb("quality_flags").$type<string[]>().notNull().default([]),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  /** When it was started mid-cycle (METHOD.md §2.9); null is the plan. */
  addedMidCycleAt: timestamp("added_mid_cycle_at", { withTimezone: true }),
  position: integer("position").notNull().default(0),
  legacyType: text("legacy_type"),
  legacyId: text("legacy_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const keyResults = pgTable("key_results", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  unit: text("unit"),
  /** Metric, maintain, milestone or baseline (METHOD.md §2.10). */
  kind: text("kind", { enum: KEY_RESULT_KINDS }).notNull().default("metric"),
  /** When a milestone was done or a baseline recorded; null until then. */
  doneAt: timestamp("done_at", { withTimezone: true }),
  direction: text("direction", { enum: KEY_RESULT_DIRECTIONS }).notNull(),
  indicatorType: text("indicator_type", { enum: INDICATOR_TYPES }).notNull(),
  baselineValue: numeric("baseline_value").notNull(),
  targetValue: numeric("target_value").notNull(),
  currentValue: numeric("current_value").notNull(),
  dueOn: date("due_on"),
  ownerId: uuid("owner_id").references(() => workspaceMembers.id),
  weight: numeric("weight").notNull().default("1"),
  kpiId: uuid("kpi_id"),
  capacity: text("capacity", { enum: CAPACITY_VERDICTS }),
  progressPct: numeric("progress_pct").notNull().default("0"),
  confidence: numeric("confidence"),
  forecast: jsonb("forecast").$type<Record<string, unknown>>(),
  score: numeric("score"),
  carryForward: boolean("carry_forward").notNull().default(false),
  qualityFlags: jsonb("quality_flags").$type<string[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  /** When it was started mid-cycle (METHOD.md §2.9); null is the plan. */
  addedMidCycleAt: timestamp("added_mid_cycle_at", { withTimezone: true }),
  legacyType: text("legacy_type"),
  legacyId: text("legacy_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const keyResultValues = pgTable("key_result_values", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id")
    .notNull()
    .references(() => keyResults.id, { onDelete: "cascade" }),
  value: numeric("value").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  authorMemberId: uuid("author_member_id").references(
    () => workspaceMembers.id,
  ),
  checkInId: uuid("check_in_id"),
  source: text("source", { enum: VALUE_SOURCES }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * Every change to a key result's target (P9-T06b, METHOD v2 §2.9). The
 * original stays on record, and easing one carries its reason.
 */
export const keyResultTargetChanges = pgTable("key_result_target_changes", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id")
    .notNull()
    .references(() => keyResults.id, { onDelete: "cascade" }),
  fromValue: numeric("from_value").notNull(),
  toValue: numeric("to_value").notNull(),
  /** The baseline the change was judged against, which can move later. */
  baselineValue: numeric("baseline_value").notNull(),
  /** Whether this change moved the target toward its baseline when made. */
  eased: boolean("eased").notNull(),
  reason: text("reason"),
  /** Whether the cycle's plan was already published (P9-T13 reads it). */
  midCycle: boolean("mid_cycle").notNull().default(false),
  actorMemberId: uuid("actor_member_id").references(() => workspaceMembers.id, {
    onDelete: "set null",
  }),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const goalRetrospectives = pgTable("goal_retrospectives", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  body: jsonb("body").notNull(),
  bodyVersion: integer("body_version").notNull(),
  authorMemberId: uuid("author_member_id").references(
    () => workspaceMembers.id,
  ),
  aiDrafted: boolean("ai_drafted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Goal = typeof goals.$inferSelect;
export type KeyResult = typeof keyResults.$inferSelect;
export type KeyResultValue = typeof keyResultValues.$inferSelect;
export type GoalRetrospective = typeof goalRetrospectives.$inferSelect;
