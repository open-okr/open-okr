/**
 * The diagnostic and the reset decisions (DATABASE.md §11, METHOD.md §8.6 and
 * §8.8, P4-T11c-a).
 *
 * Stage seven's second half reads the cycle score against the rhythm score.
 * Stage nine closes every objective with one decision and a one-line why.
 */
import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { GOAL_CLOSE_DECISIONS, goals } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * §8.6's three verdicts, spelled exactly as `packages/method` spells them.
 *
 * TECHNICAL-PLAN §4 wrote the first one as `delivered`; the method package calls
 * it `results_delivered`. Two names for one verdict is a translation layer with
 * nothing to gain and one place to get backwards, so the stored value is the
 * canon `DiagnosisKind` and the plan row is corrected.
 */
export const DIAGNOSIS_VERDICTS = [
  "results_delivered",
  "strategy_or_quality",
  "rhythm",
] as const;
export type DiagnosisVerdict = (typeof DIAGNOSIS_VERDICTS)[number];

export const reviewDiagnostics = pgTable("review_diagnostics", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  /**
   * Stored rather than recomputed on read.
   *
   * §8.6 calls this the most valuable output of the review, and the minutes have
   * to show what the room was told. A diagnostic recomputed a month later would
   * quietly change its verdict as scores were corrected, which is the one thing
   * a record must not do.
   */
  cycleScore: numeric("cycle_score").notNull(),
  rhythmScore: numeric("rhythm_score"),
  verdict: text("verdict", { enum: DIAGNOSIS_VERDICTS }).notNull(),
  /** The deterministic sentence, always present. */
  narrative: text("narrative").notNull(),
  /** Specifics an AI provider added, and null with AI off. */
  aiNarrative: text("ai_narrative"),
  recordedById: uuid("recorded_by_id")
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

export type ReviewDiagnostic = typeof reviewDiagnostics.$inferSelect;

export const reviewDecisions = pgTable("review_decisions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  /**
   * §8.8's three ways to close an objective, reusing `GOAL_CLOSE_DECISIONS`.
   *
   * A second list of the same three words is the drift this repository keeps
   * finding, and these two must agree because the decision is written back to
   * `goals.close_decision` when the session closes.
   */
  decision: text("decision", { enum: GOAL_CLOSE_DECISIONS }).notNull(),
  /** Required: a decision nobody explained is the default carry-over §8.8 stops. */
  why: text("why").notNull(),
  decidedById: uuid("decided_by_id")
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

export type ReviewDecision = typeof reviewDecisions.$inferSelect;
