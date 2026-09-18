import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * The authentication schema, owned by Better Auth (TECHNICAL-PLAN §4.1).
 *
 * The **property names** here are Better Auth's model field names and must
 * match exactly: its Drizzle adapter looks fields up by property name. The
 * column names are ours. Renaming a property breaks authentication at
 * runtime rather than at compile time, so leave them alone.
 */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  /** SHA-256 of the browser's token. See the hashing adapter in packages/core. */
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    /** Hashed by Better Auth. Null for social and passkey accounts. */
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.providerId, table.accountId)],
);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  credentialID: text("credential_id").notNull().unique(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  aaguid: text("aaguid"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const twoFactors = pgTable("two_factors", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Encrypted by Better Auth with the instance secret before it lands here. */
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count")
    .notNull()
    .default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/**
 * The SSO plugin's provider table (P8-T07c-a).
 *
 * **Derived from `sso_connections`, which is the authority.** Better Auth owns
 * the shape and the writes here, the way it owns `passkeys` and `two_factors`;
 * the product feeds it and never reads it to answer a question. See migration
 * 0097 and `docs/design/p8-t07c-saml.md`.
 *
 * The property names are Better Auth's field names, because its Drizzle
 * adapter looks columns up by them. The database columns are snake_case, the
 * same split `passkeys.credentialID` already carries.
 */
export const ssoProviders = pgTable("sso_providers", {
  id: text("id").primaryKey(),
  /** The `sso_connections.id`, not its `provider_id`. Unique instance-wide,
   * which the plugin requires and a per-workspace provider id is not. */
  providerId: text("provider_id").notNull().unique(),
  issuer: text("issuer").notNull(),
  domain: text("domain").notNull(),
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** Better Auth's organization plugin, which this product does not use.
   * Declared because the adapter looks it up; it stays null. */
  organizationId: text("organization_id"),
});

/**
 * The mapping Better Auth's Drizzle adapter expects: its model names on the
 * left, our tables on the right.
 */
export const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  passkey: passkeys,
  twoFactor: twoFactors,
  ssoProvider: ssoProviders,
} as const;
