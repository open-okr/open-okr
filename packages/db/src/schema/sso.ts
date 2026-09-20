import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Per-workspace SSO provider configuration (P8-T07, SAML added at P8-T07c).
 *
 * Each row is one identity provider. The client secret is envelope-encrypted
 * with the instance root key. Better Auth's `genericOAuth` plugin is
 * configured at boot from the OIDC rows, and `@better-auth/sso` from the SAML
 * ones.
 *
 * **This table is the authority and the plugin's own `ssoProvider` table is
 * derived from it** (P8-T07c). Which identity provider a workspace trusts is
 * business data, so it belongs somewhere with `workspace_id` and a policy, and
 * the plugin's table has neither. `docs/design/p8-t07c-saml.md` records the
 * decision and what the two alternatives cost.
 *
 * See migration 0091 for the RLS policy and the uniqueness constraint, and
 * 0096 for the SAML columns.
 */
export const ssoConnections = pgTable("sso_connections", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** `oidc` or `saml`. Defaults to oidc, so rows written before P8-T07c keep
   * their meaning with no backfill. */
  kind: text("kind").notNull().default("oidc"),
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
  /** Where the browser is sent to authenticate. SAML only. */
  samlEntryPoint: text("saml_entry_point"),
  /** The provider's entity id, which is what it calls itself when it signs. */
  samlIssuer: text("saml_issuer"),
  /** The provider's signing certificate. A public key, so not encrypted; see
   * migration 0096 for why that is deliberate rather than an oversight. */
  samlCertificate: text("saml_certificate"),
  /** What this instance calls itself to the provider. Null means its URL. */
  samlAudience: text("saml_audience"),
  samlWantAssertionsSigned: boolean("saml_want_assertions_signed")
    .notNull()
    .default(true),
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
