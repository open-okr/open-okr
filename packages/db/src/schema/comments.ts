import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Comments and reactions (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Comments are rich text on goals, key results, check-ins, cycles and
 * documents. Edit history is tracked through activities, not stored
 * revisions. Access is inherited from the parent subject through the
 * subject-to-context resolver.
 *
 * Reactions are on every major subject, not only comments. One emoji per
 * member per subject.
 */

export const COMMENT_SUBJECT_TYPES = [
  "goal",
  "key_result",
  "check_in",
  "cycle",
  "document",
] as const;
export type CommentSubjectType = (typeof COMMENT_SUBJECT_TYPES)[number];

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type", { enum: COMMENT_SUBJECT_TYPES }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  authorMemberId: uuid("author_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  body: jsonb("body").notNull(),
  bodyVersion: integer("body_version").notNull().default(1),
  editedAt: timestamp("edited_at", { withTimezone: true }),
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

export type Comment = typeof comments.$inferSelect;

export const reactions = pgTable("reactions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Reaction = typeof reactions.$inferSelect;
