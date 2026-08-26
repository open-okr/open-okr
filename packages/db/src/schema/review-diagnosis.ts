/**
 * Root causes and the process-health survey (DATABASE.md §11, METHOD.md §8.4
 * and §8.5, P4-T11b).
 *
 * Stage seven gives every key result under the threshold exactly one primary
 * cause. Stage eight scores the practice rather than the results, anonymously.
 */
import { pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { keyResults } from "./goals.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const rootCauses = pgTable("root_causes", {
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
  /** 1 to 8, indexing METHOD.md §8.4. The text is canon in `packages/method`. */
  causeKey: smallint("cause_key").notNull(),
  /** §8.4's "ask why until it stops being a symptom", and optional. */
  detail: text("detail"),
  namedById: uuid("named_by_id")
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

export type RootCause = typeof rootCauses.$inferSelect;

export const processHealthResponses = pgTable("process_health_responses", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  /** 1 to 5, indexing METHOD.md §8.5. The statements are canon. */
  statementKey: smallint("statement_key").notNull(),
  /** 1 (not true for us) to 5 (consistently true). */
  score: smallint("score").notNull(),
  /**
   * Who answered, in a form nothing can read back.
   *
   * **No member id, on purpose.** §8.5 says anonymous, and a column holding the
   * respondent would make every future join one careless line away from
   * attributing an answer. The hash is salted per review, so the same person's
   * hash differs between quarters and nobody can follow one unnamed member
   * across them.
   */
  respondentHash: text("respondent_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ProcessHealthResponse = typeof processHealthResponses.$inferSelect;
