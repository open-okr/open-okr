/**
 * Session confidence confirmations (METHOD.md §7.2, P4-T07b).
 *
 * After the vote reveal the champion confirms a final confidence and writes
 * a what-changed note for each key result. One row per KR per session.
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
  teamAverage: numeric("team_average"),
  whatChanged: text("what_changed").notNull(),
  confirmedById: uuid("confirmed_by_id")
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

export type SessionConfidence = typeof sessionConfidences.$inferSelect;
