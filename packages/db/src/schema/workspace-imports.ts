import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Workspace archive imports (TECHNICAL-PLAN SS4.13, P6-T05b).
 *
 * One row per attempt. Dry runs and real runs are both recorded so the
 * operator can compare what a dry run predicted against what the real run
 * did. The unique index on `(workspace_id, archive_digest)` for real runs
 * makes a re-import a no-op: the second attempt finds the first and
 * returns its stored report.
 */
export const workspaceImports = pgTable("workspace_imports", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  archiveDigest: text("archive_digest").notNull(),
  manifest: jsonb("manifest").notNull(),
  mode: text("mode", { enum: ["dry_run", "real"] }).notNull(),
  status: text("status", { enum: ["running", "done", "failed"] })
    .notNull()
    .default("running"),
  report: jsonb("report").notNull().default({}),
  progress: jsonb("progress").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type WorkspaceImport = typeof workspaceImports.$inferSelect;
