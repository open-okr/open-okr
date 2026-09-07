import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { blobs } from "./blobs.ts";
import { cycles } from "./cycles.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Export runs (TECHNICAL-PLAN §4.13, P5-T15). See migration 0069 for why the
 * blob is nullable and why `kind` is here before anything writes `archive`.
 */
export const exportRuns = pgTable("export_runs", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["list", "archive"] })
    .notNull()
    .default("list"),
  list: text("list").notNull(),
  format: text("format", { enum: ["csv", "xlsx"] }).notNull(),
  cycleId: uuid("cycle_id").references(() => cycles.id, {
    onDelete: "set null",
  }),
  spaceId: uuid("space_id").references(() => spaces.id, {
    onDelete: "set null",
  }),
  /** Whose export it is. The file holds what they could see, so only they collect it. */
  requestedById: uuid("requested_by_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  state: text("state", { enum: ["queued", "building", "ready", "failed"] })
    .notNull()
    .default("queued"),
  rowCount: integer("row_count"),
  filename: text("filename").notNull(),
  blobId: uuid("blob_id").references(() => blobs.id, { onDelete: "set null" }),
  /** Why it failed, phrased for the person looking at the list. */
  error: text("error"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ExportRun = typeof exportRuns.$inferSelect;
export type ExportRunState = ExportRun["state"];
export type ExportFormat = ExportRun["format"];
