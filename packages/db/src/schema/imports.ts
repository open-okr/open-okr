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
 * Import runs (TECHNICAL-PLAN §4.13 and §7.1, P6-T01a). See migration 0070 for
 * why `source` carries `flowyteam` before anything writes it, why `entity` is
 * nullable and why the report is jsonb.
 */
export const importRuns = pgTable("import_runs", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["csv", "flowyteam"] }).notNull(),
  /** Which entity template a spreadsheet run loaded. Null for a whole-company run. */
  entity: text("entity"),
  mode: text("mode", { enum: ["dry_run", "real"] }).notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] })
    .notNull()
    .default("running"),
  filename: text("filename"),
  rowsRead: integer("rows_read").notNull().default(0),
  rowsWritten: integer("rows_written").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  report: jsonb("report")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** Why the whole run failed. A row that could not be read is a skip in `report`. */
  error: text("error"),
  requestedById: uuid("requested_by_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
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

export type ImportRun = typeof importRuns.$inferSelect;
export type ImportRunSource = ImportRun["source"];
export type ImportRunMode = ImportRun["mode"];
export type ImportRunStatus = ImportRun["status"];

/** The sources a workspace can connect to rather than upload from. */
export const IMPORT_CONNECTION_SOURCES = ["flowyteam"] as const;

/**
 * A workspace's connection to a source it imports from (migration 0174,
 * docs/design/flowyteam-connect.md §4.2).
 *
 * The token columns are envelope-encrypted and opened server-side only, by the
 * import job and the revoke delivery. No read action selects them. They are
 * null once a disconnected row's token has been revoked at the source.
 */
export const importConnections = pgTable("import_connections", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  source: text("source", { enum: IMPORT_CONNECTION_SOURCES }).notNull(),
  baseUrl: text("base_url").notNull(),
  clientId: text("client_id").notNull(),
  companyId: text("company_id").notNull(),
  companyName: text("company_name").notNull(),
  tokenCiphertext: text("token_ciphertext"),
  tokenDataKey: text("token_data_key"),
  tokenKeyId: text("token_key_id"),
  scopes: text("scopes").notNull().default("flowyteam:export"),
  connectedByMemberId: uuid("connected_by_member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  /** The token no longer works: revoked here, or refused by the source later. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Somebody disconnected. Imported data and the company link stay. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ImportConnection = typeof importConnections.$inferSelect;
export type ImportConnectionSource = ImportConnection["source"];
