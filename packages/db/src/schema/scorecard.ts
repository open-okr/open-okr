import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { cycles } from "./cycles.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Performance snapshots and the points layer (TECHNICAL-PLAN §4.6, METHOD.md
 * §8.9, P3-T15).
 *
 * A snapshot is what the archive writes when a cycle closes: the result, the
 * band counts and the portfolio verdict, one row per owner. It is derived, so
 * it is never imported and never trusted from a source.
 *
 * The points layer exists and is off. No rows are written unless a workspace
 * enables it, which is a decision REQUIREMENTS.md leaves to the human.
 */

export const SNAPSHOT_OWNER_KINDS = ["workspace", "space", "member"] as const;
export type SnapshotOwnerKind = (typeof SNAPSHOT_OWNER_KINDS)[number];

export const PORTFOLIO_VERDICTS = [
  "too_safe",
  "healthy",
  "partial",
  "outran_capacity",
] as const;
export type PortfolioVerdictValue = (typeof PORTFOLIO_VERDICTS)[number];

export const performanceSnapshots = pgTable("performance_snapshots", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  ownerKind: text("owner_kind", { enum: SNAPSHOT_OWNER_KINDS }).notNull(),
  spaceId: uuid("space_id").references(() => spaces.id, {
    onDelete: "cascade",
  }),
  memberId: uuid("member_id").references(() => workspaceMembers.id, {
    onDelete: "cascade",
  }),
  /** The average score in scope, 0.00 to 1.00. Null when nothing was scored. */
  resultValue: numeric("result_value"),
  fullyAchievedCount: integer("fully_achieved_count").notNull().default(0),
  strongCount: integer("strong_count").notNull().default(0),
  partialCount: integer("partial_count").notNull().default(0),
  littleCount: integer("little_count").notNull().default(0),
  verdict: text("verdict", { enum: PORTFOLIO_VERDICTS }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const scorecardSettings = pgTable("scorecard_settings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  points: jsonb("points").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const scoreEntries = pgTable("score_entries", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").references(() => cycles.id, {
    onDelete: "set null",
  }),
  points: integer("points").notNull().default(0),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type PerformanceSnapshotRow = typeof performanceSnapshots.$inferSelect;
export type ScorecardSettingsRow = typeof scorecardSettings.$inferSelect;
export type ScoreEntryRow = typeof scoreEntries.$inferSelect;
