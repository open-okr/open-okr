/**
 * Objective narratives (DATABASE.md §11, METHOD.md §8.1 stage 3, P4-T10c).
 *
 * Stage three of the quarterly review goes owner by owner: the story behind the
 * score, and what the number does not show.
 *
 * **The body is nullable and that is the common case.** §8.1 gives the stage
 * nine minutes of talking, not writing, so most objectives are spoken for and
 * never typed. A row exists as soon as the mic moves on from an objective, and
 * `spoken_at` is what that records. Storing an empty document instead would put
 * "somebody wrote nothing" in the same shape as "nobody wrote", which the
 * minutes at P4-T12 have to tell apart.
 */
import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { goals } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const reviewNarratives = pgTable("review_narratives", {
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
  /** Editor JSON, never Markdown. Null when the objective was only spoken for. */
  body: jsonb("body"),
  bodyVersion: integer("body_version"),
  /** Null with no body: the facilitator who marked it spoken is not its author. */
  authorMemberId: uuid("author_member_id").references(
    () => workspaceMembers.id,
  ),
  /** Set when the mic moves on, which is §4.4's "facilitator marks each as spoken". */
  spokenAt: timestamp("spoken_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ReviewNarrative = typeof reviewNarratives.$inferSelect;
