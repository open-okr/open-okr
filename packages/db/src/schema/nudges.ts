import { pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { agents } from "./agents.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Nudges: every proactive message the product sends (P4-T04a).
 *
 * AI-NATIVE-PLAN.md §6.3. One row per message, sent or suppressed, so the
 * product can always answer what it sent, to whom, on whose rule, and why it
 * stayed quiet when it did.
 *
 * The columns are TECHNICAL-PLAN.md §4's. The P4-T00 design document's §7 names
 * several of them differently and omits four; the plan outranks a design
 * document, and the difference is recorded on the P4-T04a STATUS row.
 */

/** Which agent's remit a nudge belongs to, as §6.4's two tables split them. */
export const NUDGE_KINDS = ["rhythm", "quality"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** The kinds of thing a nudge can be about, as the design's §7 lists them. */
export const NUDGE_SUBJECT_TYPES = [
  "goal",
  "check_in",
  "blocker",
  "kpi",
  "session",
  "cycle",
] as const;
export type NudgeSubjectType = (typeof NUDGE_SUBJECT_TYPES)[number];

/**
 * Why a nudge was not sent.
 *
 * Four of the five are decisions the product made rather than accidents, which
 * is why they are recorded. `ceiling` is the §11 volume ceiling, and it is the
 * one that means the product decided a member had heard enough this week.
 */
export const NUDGE_SUPPRESSION_REASONS = [
  "dedup",
  "quiet_hours",
  "snooze",
  "disabled",
  "ceiling",
] as const;
export type NudgeSuppressionReason = (typeof NUDGE_SUPPRESSION_REASONS)[number];

export const nudges = pgTable("nudges", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /**
   * Resolves to the §6.4 trigger catalogue in `packages/method`.
   *
   * Text rather than an enum: the catalogue is data in the package, and a
   * database enum would hold the same list a second time and need a migration
   * to add a trigger. `isTriggerKey` is the check, and the conformance suite is
   * what keeps the package and the document in step.
   */
  ruleKey: text("rule_key").notNull(),
  kind: text("kind", { enum: NUDGE_KINDS }).notNull(),
  subjectType: text("subject_type", { enum: NUDGE_SUBJECT_TYPES }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  recipientMemberId: uuid("recipient_member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  /**
   * Null when the product itself produced it rather than a seeded agent.
   *
   * The due engine runs before either agent exists (P4-T05), and a nudge
   * carrying a fabricated agent id would misattribute it forever.
   */
  agentId: uuid("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  channel: text("channel").notNull(),
  /**
   * When it should go out, separate from when it did.
   *
   * Quiet hours and the batching window move delivery without changing what was
   * decided, and one timestamp could not tell "held until morning" from "never
   * sent".
   */
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  /**
   * When the recipient did the thing it asked for.
   *
   * This is what makes a nudge measurable rather than merely countable: a rule
   * that fires often and is never acted on is noise.
   */
  actedAt: timestamp("acted_at", { withTimezone: true }),
  /**
   * 0 for a trigger that does not escalate, 1 and up for a ladder position.
   *
   * §11's ladders widen rather than repeat, so the step is what makes a second
   * nudge about one subject legitimate instead of duplication.
   */
  escalationStep: smallint("escalation_step").notNull().default(0),
  /** Null when it was sent. Set when the product decided to stay quiet. */
  suppressedReason: text("suppressed_reason", {
    enum: NUDGE_SUPPRESSION_REASONS,
  }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Nudge = typeof nudges.$inferSelect;
