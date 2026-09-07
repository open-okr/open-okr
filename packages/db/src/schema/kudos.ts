/**
 * Recognition and wins (DATABASE.md §11, METHOD.md §8.1 stage 4, P4-T10c).
 *
 * Stage four names the effort that deserved to be seen. Specific beats generous,
 * which is why the text is required and why nothing here aggregates: a member
 * may be recognised twice in one review for two different things, and one row
 * per pair would make the second piece of recognition overwrite the first.
 *
 * Plain text rather than rich text. Three minutes of naming effort does not
 * produce formatted paragraphs, and every other free line in a session
 * (`okr_sessions.shifts`, `decisions.text`) is plain text for the same reason.
 */
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const kudos = pgTable("kudos", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  fromMemberId: uuid("from_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  toMemberId: uuid("to_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Kudo = typeof kudos.$inferSelect;
