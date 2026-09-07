import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { cycles } from "./cycles.ts";
import { goals, keyResults } from "./goals.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Horizontal alignment and the findings table (TECHNICAL-PLAN §4.5,
 * METHOD.md §5, P3-T09).
 *
 * Vertical alignment is not here: `goals.parent_goal_id` and
 * `goals.parent_key_result_id` shipped with the goal itself at P3-T04, because a
 * parent pointer is a property of the child rather than a relation of its own.
 *
 * Four invariants live in the migration as check constraints rather than here,
 * for the reason the goals schema gives: Drizzle cannot express them, and an
 * invariant only application code holds is one a single forgotten path can
 * break. A goal cannot depend on itself; a register entry names a provider one
 * way or the other; a confirmation and a decision each carry who and when; and a
 * finding's scope agrees with its scope id.
 */

export const ALIGNMENT_FINDING_SCOPES = ["workspace", "space"] as const;
export type AlignmentFindingScope = (typeof ALIGNMENT_FINDING_SCOPES)[number];

/** §5.3's four semantic types, plus the deterministic engine's own `structure`. */
export const ALIGNMENT_FINDING_KINDS = [
  "structure",
  "relink",
  "dependency",
  "conflict",
  "gap",
  /**
   * Reported health against the goal's own data (P4-T06b-a).
   *
   * Not one of METHOD.md §5.3's four semantic types, which are judgements the
   * Coach makes by reading content. This one is arithmetic, so it gets its own
   * kind rather than being filed under `gap`: a reader filtering by kind should
   * not find a deterministic finding among semantic ones.
   */
  "divergence",
] as const;
export type AlignmentFindingKind = (typeof ALIGNMENT_FINDING_KINDS)[number];

export const ALIGNMENT_SEVERITIES = ["high", "medium", "low"] as const;
export type AlignmentSeverity = (typeof ALIGNMENT_SEVERITIES)[number];

export const ALIGNMENT_FINDING_SOURCES = ["engine", "coach"] as const;
export type AlignmentFindingSource = (typeof ALIGNMENT_FINDING_SOURCES)[number];

export const ALIGNMENT_FINDING_STATES = [
  "open",
  "applied",
  "dismissed",
] as const;
export type AlignmentFindingState = (typeof ALIGNMENT_FINDING_STATES)[number];

export const goalDependencies = pgTable("goal_dependencies", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /**
   * Stored once, in canonical id order. §5.1 calls a horizontal dependency
   * two-way by meaning, so a second row saying the same thing backwards would be
   * a second thing to keep in step for no reader's benefit.
   */
  fromGoalId: uuid("from_goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  toGoalId: uuid("to_goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  note: text("note"),
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

export const keyResultDependencies = pgTable("key_result_dependencies", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id")
    .notNull()
    .references(() => keyResults.id, { onDelete: "cascade" }),
  /**
   * A team inside the workspace. Only this can clear a silo finding, because
   * only this names something the engine can find.
   */
  providerSpaceId: uuid("provider_space_id").references(() => spaces.id, {
    onDelete: "set null",
  }),
  /** A supplier, a regulator, or a team that has not joined the workspace yet. */
  providerText: text("provider_text"),
  note: text("note"),
  confirmed: boolean("confirmed").notNull().default(false),
  confirmedById: uuid("confirmed_by_id").references(() => workspaceMembers.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** Required when unconfirmed, or publish gate 4 stays red (§5.4). */
  riskOwnerId: uuid("risk_owner_id").references(() => workspaceMembers.id),
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

export const alignmentFindings = pgTable("alignment_findings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: ALIGNMENT_FINDING_SCOPES }).notNull(),
  scopeId: uuid("scope_id").references(() => spaces.id, {
    onDelete: "cascade",
  }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ALIGNMENT_FINDING_KINDS }).notNull(),
  severity: text("severity", { enum: ALIGNMENT_SEVERITIES }).notNull(),
  /**
   * Nullable, decision D-16. The anchor finding has no subject because no goal
   * caused it: it is the absence of one. Attaching it to an arbitrary goal would
   * send a facilitator to fix something that is not broken.
   */
  subjectGoalId: uuid("subject_goal_id").references(() => goals.id, {
    onDelete: "cascade",
  }),
  targetGoalId: uuid("target_goal_id").references(() => goals.id, {
    onDelete: "cascade",
  }),
  /**
   * Which measure this is about, when it is about one (P5-T14).
   *
   * Additional to `subject_goal_id`, never a replacement: a finding that named
   * only a key result would vanish from every surface that already asks about
   * goals. What it changes is the finding identity, so a goal with three key
   * results can carry three findings that do not overwrite each other. Null on
   * everything the four earlier sweeps write.
   */
  subjectKeyResultId: uuid("subject_key_result_id").references(
    () => keyResults.id,
    { onDelete: "cascade" },
  ),
  reason: text("reason").notNull(),
  ruleKey: text("rule_key"),
  source: text("source", { enum: ALIGNMENT_FINDING_SOURCES })
    .notNull()
    .default("engine"),
  state: text("state", { enum: ALIGNMENT_FINDING_STATES })
    .notNull()
    .default("open"),
  decidedById: uuid("decided_by_id").references(() => workspaceMembers.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type GoalDependencyRow = typeof goalDependencies.$inferSelect;
export type KeyResultDependencyRow = typeof keyResultDependencies.$inferSelect;
export type AlignmentFindingRow = typeof alignmentFindings.$inferSelect;
