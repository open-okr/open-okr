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
import { goals, keyResults } from "./goals.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Check-ins, their snapshots and the private confidence votes (TECHNICAL-PLAN
 * §4.4, METHOD.md §7.2, P3-T07).
 *
 * Three invariants are check constraints in migration 0023 rather than here: a
 * published check-in carries its status, its confidence and its narrative; an
 * acknowledgement names both who and when or neither; and nothing acknowledges a
 * draft.
 *
 * **The snapshot has its own table because it is immutable.** An edit inside the
 * window writes a new row and moves the pointer, so the difference a reviewer
 * already read cannot change under them.
 */

export const CHECK_IN_STATES = ["draft", "published"] as const;
export type CheckInState = (typeof CHECK_IN_STATES)[number];

/** §3.5's three live statuses. `outdated` is derived, never reported. */
export const CHECK_IN_STATUSES = ["on_track", "caution", "off_track"] as const;
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];

/** One key result's state at the moment of publication (§6.2). */
export interface SnapshotEntry {
  readonly keyResultId: string;
  readonly title: string;
  readonly value: number;
  readonly previousValue: number | null;
  readonly progressPct: number;
  readonly confidence: number | null;
  readonly previousConfidence: number | null;
}

export const checkIns = pgTable("check_ins", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type", { enum: ["goal"] })
    .notNull()
    .default("goal"),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  authorMemberId: uuid("author_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  state: text("state", { enum: CHECK_IN_STATES }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  status: text("status", { enum: CHECK_IN_STATUSES }),
  confidence: numeric("confidence"),
  narrative: jsonb("narrative"),
  narrativeVersion: integer("narrative_version"),
  snapshotId: uuid("snapshot_id"),
  /** No foreign key: sessions are domain G at P4-T04. */
  sessionId: uuid("session_id"),
  acknowledgedById: uuid("acknowledged_by_id").references(
    () => workspaceMembers.id,
  ),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  aiDrafted: boolean("ai_drafted").notNull().default(false),
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

export const checkInSnapshots = pgTable("check_in_snapshots", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  checkInId: uuid("check_in_id")
    .notNull()
    .references(() => checkIns.id, { onDelete: "cascade" }),
  entries: jsonb("entries").$type<SnapshotEntry[]>().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const checkInVotes = pgTable("check_in_votes", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  checkInId: uuid("check_in_id").references(() => checkIns.id, {
    onDelete: "cascade",
  }),
  keyResultId: uuid("key_result_id")
    .notNull()
    .references(() => keyResults.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id"),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  confidence: numeric("confidence").notNull(),
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type CheckIn = typeof checkIns.$inferSelect;
export type CheckInSnapshot = typeof checkInSnapshots.$inferSelect;
export type CheckInVote = typeof checkInVotes.$inferSelect;
