import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { goals } from "./goals.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * KPIs, their categories, records and narrow shares (TECHNICAL-PLAN §4.6,
 * METHOD.md §6, P3-T12).
 *
 * A KPI is a measure that runs continuously; a key result lives inside one
 * cycle. That difference is the whole reason this is its own table rather than a
 * flag on `key_results`.
 *
 * Six invariants live in the migration as check constraints rather than here,
 * for the reason the goals schema gives: Drizzle cannot express them, and an
 * invariant only application code holds is one a single forgotten path can
 * break. An owner that agrees with its kind; a KPI that is not its own parent; a
 * corridor whose watch band is not above its healthy band; and a formula that
 * belongs to a calculated KPI and only to one.
 */

export const KPI_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type KpiFrequencyValue = (typeof KPI_FREQUENCIES)[number];

export const KPI_DIRECTIONS = ["higher_better", "lower_better"] as const;
export type KpiDirectionValue = (typeof KPI_DIRECTIONS)[number];

export const KPI_TIERS = ["input", "output", "outcome", "impact"] as const;
export type KpiTier = (typeof KPI_TIERS)[number];

export const KPI_AGGREGATES = ["sum", "avg", "max", "min", "count"] as const;
export type KpiAggregate = (typeof KPI_AGGREGATES)[number];

export const KPI_STATES = [
  "healthy",
  "watch",
  "unhealthy",
  "recovering",
  "no_data",
] as const;
export type KpiStateValue = (typeof KPI_STATES)[number];

export const KPI_OWNER_KINDS = ["workspace", "space", "member"] as const;
export type KpiOwnerKind = (typeof KPI_OWNER_KINDS)[number];

export const KPI_SHARE_ACCESS = ["read", "update"] as const;
export type KpiShareAccess = (typeof KPI_SHARE_ACCESS)[number];

export const kpiCategories = pgTable("kpi_categories", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
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

export const kpis = pgTable("kpis", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  shortId: text("short_id").notNull(),
  /** No foreign key: P3-T14 decides whether a tree is a row or a parent chain. */
  treeId: uuid("tree_id"),
  categoryId: uuid("category_id").references(() => kpiCategories.id, {
    onDelete: "set null",
  }),
  parentKpiId: uuid("parent_kpi_id"),
  title: text("title").notNull(),
  description: jsonb("description"),
  descriptionVersion: integer("description_version"),
  ownerKind: text("owner_kind", { enum: KPI_OWNER_KINDS })
    .notNull()
    .default("workspace"),
  spaceId: uuid("space_id").references(() => spaces.id, {
    onDelete: "set null",
  }),
  memberId: uuid("member_id").references(() => workspaceMembers.id, {
    onDelete: "set null",
  }),
  frequency: text("frequency", { enum: KPI_FREQUENCIES }).notNull(),
  unit: text("unit"),
  direction: text("direction", { enum: KPI_DIRECTIONS })
    .notNull()
    .default("higher_better"),
  indicatorType: text("indicator_type", { enum: ["leading", "lagging"] })
    .notNull()
    .default("lagging"),
  tier: text("tier", { enum: KPI_TIERS }).notNull().default("output"),
  targetDefault: numeric("target_default"),
  aggregate: text("aggregate", { enum: KPI_AGGREGATES })
    .notNull()
    .default("sum"),
  isCalculated: boolean("is_calculated").notNull().default(false),
  formula: jsonb("formula"),
  /**
   * The corridor, per KPI, defaulting to the §11 registry values. Stored rather
   * than resolved on every read because a KPI may deviate by design, and the
   * grid colours thousands of cells from it.
   */
  healthyPct: numeric("healthy_pct").notNull().default("90"),
  watchPct: numeric("watch_pct").notNull().default("70"),
  /** Derived. Written only by the recompute entry point. */
  state: text("state", { enum: KPI_STATES }).notNull().default("no_data"),
  achievementPct: numeric("achievement_pct"),
  effectivePct: numeric("effective_pct"),
  recoveryGoalId: uuid("recovery_goal_id").references(() => goals.id, {
    onDelete: "set null",
  }),
  recoveryStartedPct: numeric("recovery_started_pct"),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
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

export const kpiRecords = pgTable("kpi_records", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kpiId: uuid("kpi_id")
    .notNull()
    .references(() => kpis.id, { onDelete: "cascade" }),
  /** Normalised per frequency before it reaches the unique index. */
  periodStart: date("period_start").notNull(),
  targetValue: numeric("target_value"),
  actualValue: numeric("actual_value"),
  remark: text("remark"),
  authorMemberId: uuid("author_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
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

export const kpiShares = pgTable("kpi_shares", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kpiId: uuid("kpi_id")
    .notNull()
    .references(() => kpis.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  access: text("access", { enum: KPI_SHARE_ACCESS }).notNull(),
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

export type KpiCategoryRow = typeof kpiCategories.$inferSelect;
export type KpiRow = typeof kpis.$inferSelect;
export type KpiRecordRow = typeof kpiRecords.$inferSelect;
export type KpiShareRow = typeof kpiShares.$inferSelect;
