import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { blobs } from "./blobs.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Documents, their published versions and attachments (TECHNICAL-PLAN §4.9,
 * P5-T12).
 *
 * A document has no access context of its own: it inherits its subject's, and
 * the draft rule narrows it further. Both are in the migration's own header,
 * along with the check constraint that keeps `published_at` and `state` from
 * disagreeing.
 */

export const DOCUMENT_SUBJECT_TYPES = [
  "space",
  "goal",
  "key_result",
  "initiative",
  "cycle",
  "session",
] as const;
export type DocumentSubjectType = (typeof DOCUMENT_SUBJECT_TYPES)[number];

export const DOCUMENT_STATES = ["draft", "published"] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/**
 * Wider than the document list, because §4.9 says files go on any subject and a
 * task is as likely to carry one as a goal.
 */
export const ATTACHMENT_SUBJECT_TYPES = [
  "space",
  "goal",
  "key_result",
  "initiative",
  "cycle",
  "session",
  "task",
  "document",
  "check_in",
] as const;
export type AttachmentSubjectType = (typeof ATTACHMENT_SUBJECT_TYPES)[number];

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type", {
    enum: DOCUMENT_SUBJECT_TYPES,
  }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  title: text("title").notNull(),
  body: jsonb("body"),
  bodyVersion: integer("body_version"),
  state: text("state", { enum: DOCUMENT_STATES }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  authorMemberId: uuid("author_member_id")
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

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  body: jsonb("body"),
  bodyVersion: integer("body_version"),
  authorMemberId: uuid("author_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type", {
    enum: ATTACHMENT_SUBJECT_TYPES,
  }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  blobId: uuid("blob_id")
    .notNull()
    .references(() => blobs.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
