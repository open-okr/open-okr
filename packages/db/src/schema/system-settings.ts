import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Instance settings (TECHNICAL-PLAN §4.2, §8.2).
 *
 * Key and value, so adding a setting is a registry entry rather than a
 * migration. Secrets sit in the same row as the setting they belong to, sealed
 * by the key ring, so a mail host and its password are one lookup and cannot
 * drift apart.
 */
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default(null),
  /** The secret, encrypted under a per-secret data key. Base64. */
  secretCiphertext: text("secret_ciphertext"),
  /** That data key, wrapped by a root key held only in the environment. */
  secretDataKey: text("secret_data_key"),
  /** Which root key wrapped it, so rotation knows what to re-wrap. */
  secretKeyId: text("secret_key_id"),
  /** Where the value came from: 'wizard', 'environment' or 'admin'. */
  source: text("source").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
