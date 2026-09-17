import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Per-workspace SSO (OIDC) provider configuration (P8-T07).
 *
 * Each row is one identity provider. The client secret is envelope-encrypted
 * with the instance root key. Better Auth's `genericOAuth` plugin is
 * configured at boot from these rows.
 *
 * See migration 0091 for the RLS policy and the uniqueness constraint.
 */
export const ssoConnections = pgTable("sso_connections", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  displayName: text("display_name").notNull(),
  discoveryUrl: text("discovery_url"),
  authorizationUrl: text("authorization_url"),
  tokenUrl: text("token_url"),
  userInfoUrl: text("user_info_url"),
  clientId: text("client_id").notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretDataKey: text("secret_data_key").notNull(),
  secretKeyId: text("secret_key_id").notNull(),
  scopes: text("scopes").notNull().default("openid email profile"),
  enforce: boolean("enforce").notNull().default(false),
  emailDomains: text("email_domains").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SSOConnection = typeof ssoConnections.$inferSelect;
