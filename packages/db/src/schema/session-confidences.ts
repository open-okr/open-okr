/**
 * Session confidence confirmations (METHOD.md §7.2, P4-T07b).
 *
 * After the vote reveal the champion confirms a final confidence and writes
 * a what-changed note for each key result. One row per KR per session, and a
 * low one carries its next action (P9-T19a-b).
 */
import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { keyResults } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const sessionConfidences = pgTable("session_confidences", {
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
  confirmedConfidence: numeric("confirmed_confidence").notNull(),
  /**
   * The key result's confidence just before this session first confirmed it
   * (migration 0138), so a fall into the low band is seen in the session as
   * it is in a check-in. Null on rows written before it existed.
   */
  previousConfidence: numeric("previous_confidence"),
  teamAverage: numeric("team_average"),
  whatChanged: text("what_changed").notNull(),
  confirmedById: uuid("confirmed_by_id")
    .notNull()
    .references(() => workspaceMembers.id),
  /**
   * The next action a low score gets, with its owner, due by the goal's next
   * check-in (METHOD.md §7.2 step 2, P9-T19a-b, migration 0129). A blocker
   * only where something is actually blocked; the three are set together.
   */
  nextAction: text("next_action"),
  nextActionOwnerId: uuid("next_action_owner_id").references(
    () => workspaceMembers.id,
  ),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SessionConfidence = typeof sessionConfidences.$inferSelect;
