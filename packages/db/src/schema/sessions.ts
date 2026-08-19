/**
 * Sessions: the three OKR rituals as records (TECHNICAL-PLAN §4, P4-T07a).
 *
 * Schema note: the session design document (p4-t00-session-design.md §1)
 * uses `current_stage integer`, `status: open` and `closed_at`. TECHNICAL-PLAN
 * §4 uses `stage_key text`, `state: running` and `ended_at`, and outranks the
 * design document per CLAUDE.md's authority order. The design document is
 * corrected in the same change that adds this table.
 *
 * The vector column is typed as text because Drizzle has no native jsonb
 * type for the `elapsed` and `notes` columns — they are typed as jsonb in the
 * migration and as Record<string, unknown> here.
 */
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { cycles } from "./cycles.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const SESSION_KINDS = [
  "planning",
  "weekly",
  "monthly",
  "quarterly",
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATES = [
  "scheduled",
  "running",
  "closed",
  "skipped",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

// The database table is `okr_sessions` to avoid clashing with Better Auth's
// own `sessions` table (0004_auth.sql). The Drizzle variable is also named
// `sessions` here (aliased to `okrSessions` in the package index).
export const sessions = pgTable("okr_sessions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").references(() => spaces.id, {
    onDelete: "cascade",
  }),
  cycleId: uuid("cycle_id").references(() => cycles.id, {
    onDelete: "set null",
  }),
  kind: text("kind", { enum: SESSION_KINDS }).notNull(),
  title: text("title").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  facilitatorId: uuid("facilitator_id")
    .notNull()
    .references(() => workspaceMembers.id),
  /** Current stage key (e.g. 'confidence', 'diagnose'). Null until opened. */
  stageKey: text("stage_key"),
  stageStartedAt: timestamp("stage_started_at", { withTimezone: true }),
  /** Seconds spent per stage, keyed by stage_key. */
  elapsed: jsonb("elapsed")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  /** Per-stage facilitator notes, keyed by stage_key. */
  notes: jsonb("notes").$type<Record<string, unknown>>().notNull().default({}),
  state: text("state", { enum: SESSION_STATES }).notNull().default("scheduled"),
  /** FK to the digest row once P4-T08 adds the digests table. */
  digestId: uuid("digest_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Session = typeof sessions.$inferSelect;
