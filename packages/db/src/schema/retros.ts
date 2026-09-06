/**
 * The two retros (DATABASE.md §11, METHOD.md §8.1 stages 5 and 6, §8.7,
 * P4-T11a).
 *
 * Stage five is the team's, written silently and then dot voted. Stage six is
 * the four questions leadership answers out loud.
 *
 * **Stored apart because they are read apart.** The management retro is visible
 * to a space's managers and coordinators only, and one table with a visibility
 * column would put both audiences a forgotten predicate away from each other.
 */
import { pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/** §8.1's two columns. The structure is canon; a third would be a different retro. */
export const RETRO_COLUMNS = ["worked", "didnt"] as const;
export type RetroColumn = (typeof RETRO_COLUMNS)[number];

export const retroNotes = pgTable("retro_notes", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  columnKey: text("column_key", { enum: RETRO_COLUMNS }).notNull(),
  text: text("text").notNull(),
  /**
   * The dot count, denormalised from `retro_votes`.
   *
   * Written in the same transaction as every vote so the two cannot drift, and a
   * test asserts it equals the row count rather than trusting that it was
   * maintained. TECHNICAL-PLAN §4 specifies the column and the board sorts on it.
   */
  votes: smallint("votes").notNull().default(0),
  /** Optional: §8.1 asks for silent writing, and a name changes what people write. */
  authorMemberId: uuid("author_member_id").references(
    () => workspaceMembers.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type RetroNote = typeof retroNotes.$inferSelect;

export const retroVotes = pgTable("retro_votes", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  noteId: uuid("note_id")
    .notNull()
    .references(() => retroNotes.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
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

export type RetroVote = typeof retroVotes.$inferSelect;

export const managementAnswers = pgTable("management_answers", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  /**
   * 1 to 4, indexing METHOD.md §8.7's four questions.
   *
   * The questions themselves are canon and live in `packages/method`, never
   * here: storing the text would let a workspace edit a question §11 lists as
   * unchangeable structure, and would leave old rows quoting a question nobody
   * asked.
   */
  questionKey: smallint("question_key").notNull(),
  body: text("body").notNull(),
  answeredById: uuid("answered_by_id")
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

export type ManagementAnswer = typeof managementAnswers.$inferSelect;
