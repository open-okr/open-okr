/**
 * Reading and writing instance settings (TECHNICAL-PLAN §4.2, §8.2).
 *
 * The one place that turns a `system_settings` row into a value and back.
 * Secrets go through the key ring on the way in and out, so no caller ever
 * holds ciphertext and no caller ever writes plaintext.
 *
 * Resolution order, highest first:
 *
 *   1. the database, written by the wizard or instance administration
 *   2. the environment, which bootstraps an instance before the wizard runs
 *   3. the registry default
 *
 * The environment sits in the middle rather than on top so an operator can
 * change a setting in the product without the container's environment silently
 * overriding it at the next restart. §4.2 calls the environment "bootstrap",
 * and that is what it is: a starting value, not an override.
 */
import { systemSettings, withInstanceAdmin } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  decryptSecret,
  encryptSecret,
  type KeyRing,
  type SealedSecret,
} from "./key-ring.ts";

/** Where a resolved value came from. Shown in the admin screen. */
export type SettingSource = "database" | "environment" | "default";

export interface ResolvedSetting<T> {
  readonly value: T;
  readonly source: SettingSource;
}

/** A setting as written. `secret` is sealed before it reaches the database. */
export interface SettingWrite {
  readonly key: string;
  readonly value?: unknown;
  readonly secret?: string;
  /** Recorded on the row so the admin screen can say where it came from. */
  readonly source?: "wizard" | "environment" | "admin";
}

interface SettingRow {
  readonly key: string;
  readonly value: unknown;
  readonly secretCiphertext: string | null;
  readonly secretDataKey: string | null;
  readonly secretKeyId: string | null;
}

const sealedFrom = (row: SettingRow): SealedSecret | undefined =>
  row.secretCiphertext && row.secretDataKey && row.secretKeyId
    ? {
        ciphertext: row.secretCiphertext,
        dataKey: row.secretDataKey,
        keyId: row.secretKeyId,
      }
    : undefined;

/** Every stored setting, by key. Secrets stay sealed. */
export async function readSettingRows(
  pool: Pool,
): Promise<ReadonlyMap<string, SettingRow>> {
  const db = drizzle(pool);
  const rows = await db
    .select({
      key: systemSettings.key,
      value: systemSettings.value,
      secretCiphertext: systemSettings.secretCiphertext,
      secretDataKey: systemSettings.secretDataKey,
      secretKeyId: systemSettings.secretKeyId,
    })
    .from(systemSettings);

  return new Map(rows.map((row) => [row.key, row]));
}

/** One stored setting's plain value, or undefined when it is not set. */
export async function readSetting(
  pool: Pool,
  key: string,
): Promise<unknown | undefined> {
  const db = drizzle(pool);
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  return row?.value ?? undefined;
}

/**
 * One stored secret, opened.
 *
 * Returns undefined when the setting is absent or holds no secret, so a caller
 * can tell "no password configured" from "the password is the empty string".
 */
export async function readSecret(
  pool: Pool,
  ring: KeyRing,
  key: string,
): Promise<string | undefined> {
  const db = drizzle(pool);
  const [row] = await db
    .select({
      key: systemSettings.key,
      value: systemSettings.value,
      secretCiphertext: systemSettings.secretCiphertext,
      secretDataKey: systemSettings.secretDataKey,
      secretKeyId: systemSettings.secretKeyId,
    })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  if (!row) {
    return undefined;
  }
  const sealed = sealedFrom(row);
  return sealed ? decryptSecret(ring, sealed) : undefined;
}

/**
 * Writes settings, sealing any secret on the way in.
 *
 * Takes the whole batch in one transaction so a wizard step either lands
 * completely or not at all: a mail host stored without its password would
 * leave the instance in a state that tests as configured and fails on first
 * send.
 */
export async function writeSettings(
  pool: Pool,
  ring: KeyRing,
  writes: readonly SettingWrite[],
): Promise<void> {
  if (writes.length === 0) {
    return;
  }

  const db = drizzle(pool);
  await withInstanceAdmin(db, async (tx) => {
    for (const write of writes) {
      const sealed =
        write.secret === undefined
          ? undefined
          : encryptSecret(ring, write.secret);

      const row = {
        key: write.key,
        // The JSON null, not SQL NULL. The column is not-null on purpose: a
        // setting that exists with no plain part (a secret-only row such as
        // the mail password) is a different thing from a column with nothing
        // in it, and only one of the two is storable here.
        value: write.value === undefined ? sql`'null'::jsonb` : write.value,
        secretCiphertext: sealed?.ciphertext ?? null,
        secretDataKey: sealed?.dataKey ?? null,
        secretKeyId: sealed?.keyId ?? null,
        source: write.source ?? "admin",
        updatedAt: new Date(),
      };

      // openokr:allow-mutation: instance settings are not workspace data. The
      // Operation pipeline needs a workspace and an acting member to write its
      // activity and audit rows, and audit_events.workspace_id is not null, so
      // there is no chain for an instance write to join. The wizard has neither
      // when it stores secrets, because it runs before any workspace exists.
      // Instance-level audit is recorded as a follow-up on P8-T03.
      await tx
        .insert(systemSettings)
        .values(row)
        .onConflictDoUpdate({ target: systemSettings.key, set: row });
    }
  });
}

/** Removes a setting, so the registry default applies again. */
export async function clearSetting(pool: Pool, key: string): Promise<void> {
  const db = drizzle(pool);
  // openokr:allow-mutation: see writeSettings above. Same reasoning.
  await withInstanceAdmin(db, (tx) =>
    tx.delete(systemSettings).where(eq(systemSettings.key, key)),
  );
}

/**
 * Resolves a setting across the database, the environment and the default.
 *
 * `environmentValue` is passed in rather than read here, because this module
 * must not decide which environment variable belongs to which setting. That
 * mapping lives in the instance registry with the defaults.
 */
export function resolveSetting<T>(
  stored: unknown | undefined,
  environmentValue: T | undefined,
  fallback: T,
): ResolvedSetting<T> {
  if (stored !== undefined && stored !== null) {
    return { value: stored as T, source: "database" };
  }
  if (environmentValue !== undefined) {
    return { value: environmentValue, source: "environment" };
  }
  return { value: fallback, source: "default" };
}
