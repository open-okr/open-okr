/**
 * The session an external agent holds while it works (P5-T09b).
 *
 * A session is bound to a grant and is a record rather than an authority: every
 * request still presents its access token and is resolved from scratch. See
 * migration 0063 for why the identifier is stored as a digest anyway.
 */
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { oauthGrants } from "./oauth.ts";
import { workspaces } from "./workspaces.ts";

export const mcpSessions = pgTable(
  "mcp_sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    sessionHash: text("session_hash").notNull(),
    protocolVersion: text("protocol_version").notNull(),
    clientName: text("client_name"),
    clientVersion: text("client_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("mcp_sessions_hash_idx").on(table.sessionHash),
    index("mcp_sessions_grant_idx").on(table.workspaceId, table.grantId),
  ],
);

export type McpSession = typeof mcpSessions.$inferSelect;
