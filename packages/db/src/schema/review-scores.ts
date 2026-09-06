/**
 * Scoring the key results (TECHNICAL-PLAN §4.8, METHOD.md §8.3, P4-T10b-a).
 *
 * Stage two's grades, held here until the session closes and then written back
 * to `key_results.score`.
 *
 * **Why not straight onto the key result.** §8.3 hides the objective score until
 * the room reveals it, and a score on the key result is visible to anybody
 * reading the goal page immediately, which is the reveal leaking. A grade also
 * has to be revisable while the room talks: none of it is a fact about the key
 * result until the review is over.
 */
import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { keyResults } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const reviewScores = pgTable("review_scores", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id")
    .notNull()
    .references(() => keyResults.id, { onDelete: "cascade" }),
  /** 0.0 to 1.0, as §3.3 grades it. */
  score: numeric("score").notNull(),
  /** §8.3's one-line reason. Required: a score nobody explained is refusable. */
  reason: text("reason").notNull(),
  scoredById: uuid("scored_by_id")
    .notNull()
    .references(() => workspaceMembers.id),
  /**
   * Set when the room reveals the objective this key result belongs to.
   *
   * On the row rather than on the objective, so the reveal is one update over an
   * objective's rows and every client reads the same answer from it. Same shape
   * and same reason as `check_in_votes.revealed_at` (P3-T07). P4-T10b-b writes
   * it.
   */
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ReviewScore = typeof reviewScores.$inferSelect;
