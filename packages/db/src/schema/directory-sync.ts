import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { ssoConnections } from "./sso.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Per-workspace SCIM bearer tokens (P8-T08).
 *
 * One live token per workspace. The plaintext is shown once at creation.
 * The token_hash is SHA-256, following the session-token pattern.
 */
export const directorySyncTokens = pgTable("directory_sync_tokens", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  label: text("label").notNull().default("SCIM token"),
  ssoConnectionId: uuid("sso_connection_id").references(
    () => ssoConnections.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type DirectorySyncToken = typeof directorySyncTokens.$inferSelect;

/**
 * SCIM operation log (P8-T08).
 *
 * Records what the directory asked for and what happened. Operational,
 * not an audit event.
 */
export const directorySyncLog = pgTable("directory_sync_log", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  operation: text("operation").notNull(),
  externalId: text("external_id").notNull(),
  localId: uuid("local_id"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  requestBody: jsonb("request_body"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DirectorySyncLogEntry = typeof directorySyncLog.$inferSelect;

/**
 * A directory group mapped to a space (P8-T08b).
 *
 * The mapping is a row rather than a name match, because a renamed group is
 * the same group: matching on the display name would leave a workspace with
 * two spaces holding the same people the first time somebody renames one.
 *
 * See migration 0095 for the two unique indexes and the policy.
 */
export const directorySyncGroups = pgTable("directory_sync_groups", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  displayName: text("display_name").notNull(),
  spaceId: uuid("space_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DirectorySyncGroup = typeof directorySyncGroups.$inferSelect;
