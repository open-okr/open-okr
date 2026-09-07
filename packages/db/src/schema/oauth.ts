/**
 * The authorisation server's tables (AI-NATIVE-PLAN.md §8.2, P5-T08a).
 *
 * Five tables for five lifetimes: a client lives for years, a grant until
 * somebody ends it, a code for a minute, an access token for an hour, and a
 * refresh token until its first use. See migration 0062 for why none of them
 * are collapsed into another.
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
import { workspaceMembers, workspaces } from "./workspaces.ts";

/** Where a client came from. */
export const OAUTH_CLIENT_SOURCES = ["allow_list", "registered"] as const;

/** A client registers with the instance, never with a workspace. */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    redirectUris: text("redirect_uris").array().notNull().$type<string[]>(),
    source: text("source", { enum: OAUTH_CLIENT_SOURCES })
      .notNull()
      .default("allow_list"),
    metadataUrl: text("metadata_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("oauth_clients_client_id_idx").on(table.clientId)],
);

/** One person's decision about one client in one workspace. */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull().$type<string[]>(),
    resource: text("resource").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("oauth_grants_member_idx").on(table.workspaceId, table.memberId),
  ],
);

/** The authorisation code, single use and short-lived. */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    challenge: text("challenge").notNull(),
    challengeMethod: text("challenge_method").notNull().default("S256"),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("oauth_codes_hash_idx").on(table.codeHash)],
);

/** The token every tool call presents. */
export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("oauth_access_tokens_hash_idx").on(table.tokenHash),
    index("oauth_access_tokens_grant_idx").on(table.workspaceId, table.grantId),
  ],
);

/**
 * The refresh token, and the chain each use leaves behind.
 *
 * `replacedBy` is self-referential on purpose: it is what makes the lineage
 * walkable from any link, which is what reuse detection needs when the token
 * presented twice is three rotations old.
 */
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("oauth_refresh_tokens_hash_idx").on(table.tokenHash),
    index("oauth_refresh_tokens_grant_idx").on(
      table.workspaceId,
      table.grantId,
    ),
  ],
);

export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type OAuthCode = typeof oauthCodes.$inferSelect;
export type OAuthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
