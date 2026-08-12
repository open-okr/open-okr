import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * The annual frame, cycles and rhythm settings (TECHNICAL-PLAN §4.3,
 * METHOD.md §2.1, §11, P3-T02).
 *
 * The cycle is the workflow container, not a date range. Its child tables (the
 * input pack, prior scores, issues, priorities, gate state, calibration) arrive
 * with the guided workflow at P3-T03.
 *
 * Indexes live in the migration: several are partial, and a Drizzle declaration
 * that dropped the predicate would describe an index the database does not have.
 */

export const CYCLE_MODES = ["annual", "quarterly"] as const;
export type CycleMode = (typeof CYCLE_MODES)[number];

export const CYCLE_CADENCES = [
  "annual",
  "semiannual",
  "quarterly",
  "monthly",
] as const;
export type CycleCadence = (typeof CYCLE_CADENCES)[number];

export const CYCLE_STATUSES = [
  "planning",
  "active",
  "closing",
  "closed",
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const GOAL_LEVELS = [
  "company",
  "department",
  "team",
  "individual",
] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

/** One booked session: which ritual, and the local date it sits on. */
export interface CycleSessionDate {
  readonly key: string;
  readonly on: string;
}

export const annualFrames = pgTable("annual_frames", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  yearLabel: text("year_label").notNull(),
  horizonLabel: text("horizon_label"),
  mission: jsonb("mission"),
  missionVersion: integer("mission_version"),
  vision: jsonb("vision"),
  visionVersion: integer("vision_version"),
  strategy: jsonb("strategy"),
  strategyVersion: integer("strategy_version"),
  agreed: boolean("agreed").notNull().default(false),
  openIssues: jsonb("open_issues"),
  openIssuesVersion: integer("open_issues_version"),
  notDoing: jsonb("not_doing"),
  notDoingVersion: integer("not_doing_version"),
  /** Set when a newer frame replaces this one. §2.1 never rewrites a frame. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const annualStrategies = pgTable("annual_strategies", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  frameId: uuid("frame_id")
    .notNull()
    .references(() => annualFrames.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
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

export const cycles = pgTable("cycles", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mode: text("mode", { enum: CYCLE_MODES }).notNull().default("quarterly"),
  cadence: text("cadence", { enum: CYCLE_CADENCES })
    .notNull()
    .default("quarterly"),
  /** Local calendar dates in the workspace timezone, not instants. */
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: text("status", { enum: CYCLE_STATUSES })
    .notNull()
    .default("planning"),
  /** The facilitator's position, 0 to 7. Never a completion record. */
  phase: smallint("phase").notNull().default(1),
  frameId: uuid("frame_id").references(() => annualFrames.id),
  previousCycleId: uuid("previous_cycle_id"),
  sponsorId: uuid("sponsor_id").references(() => workspaceMembers.id),
  facilitatorId: uuid("facilitator_id").references(() => workspaceMembers.id),
  sessionDates: jsonb("session_dates")
    .$type<CycleSessionDate[]>()
    .notNull()
    .default([]),
  publicationDeadline: date("publication_deadline"),
  packDistributedAt: timestamp("pack_distributed_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  levels: jsonb("levels")
    .$type<GoalLevel[]>()
    .notNull()
    .default(["company", "department", "team"]),
  contributingUnits: text("contributing_units"),
  firstCycle: boolean("first_cycle").notNull().default(false),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
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

/**
 * One row per workspace, written at provisioning.
 *
 * The three columns beside `overrides` are §11 parameters TECHNICAL-PLAN §4.3
 * gives their own columns. They are therefore excluded from `overrides`: one
 * value with two homes is a value nobody owns.
 */
export const rhythmSettings = pgTable("rhythm_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  defaultCheckInFrequency: text("default_check_in_frequency", {
    enum: ["daily", "weekly", "biweekly", "monthly", "quarterly"],
  })
    .notNull()
    .default("weekly"),
  checkInAnchorDay: smallint("check_in_anchor_day").notNull().default(1),
  coachStrictness: text("coach_strictness", {
    enum: ["advisory", "warn", "strict"],
  })
    .notNull()
    .default("warn"),
  overrides: jsonb("overrides")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  labels: jsonb("labels")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnnualFrame = typeof annualFrames.$inferSelect;
export type AnnualStrategy = typeof annualStrategies.$inferSelect;
export type Cycle = typeof cycles.$inferSelect;
export type RhythmSettingsRow = typeof rhythmSettings.$inferSelect;
