import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Files and blobs (TECHNICAL-PLAN §4.9, P2-T05). See migration 0011 for the
 * `pending` status and the reasoning behind each index.
 */
export const blobs = pgTable("blobs", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  filesize: bigint("filesize", { mode: "number" }),
  digest: text("digest"),
  storageKey: text("storage_key").notNull(),
  authorMemberId: uuid("author_member_id").references(
    () => workspaceMembers.id,
  ),
  status: text("status", {
    enum: ["pending", "ok", "scanning", "quarantined"],
  })
    .notNull()
    .default("pending"),
  width: integer("width"),
  height: integer("height"),
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

export type Blob = typeof blobs.$inferSelect;
export type BlobStatus = Blob["status"];
