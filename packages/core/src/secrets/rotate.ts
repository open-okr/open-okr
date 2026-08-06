/**
 * Root key rotation (TECHNICAL-PLAN §8.2: "one-command rotation that re-wraps
 * data keys only").
 *
 * Every stored secret has its data key unwrapped with whichever root key
 * sealed it and wrapped again with the current one. The secret's own
 * ciphertext is never touched, so rotation never decrypts anything and never
 * holds a plaintext credential.
 *
 * Interrupting this is safe. Each secret is re-wrapped in its own statement,
 * and a secret still on an old key opens as long as that key remains on the
 * ring. So a rotation that dies halfway leaves a readable instance and can be
 * run again.
 */
import { systemSettings, withInstanceAdmin } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type KeyRing, rewrapSecret } from "./key-ring.ts";

export interface RotationReport {
  readonly examined: number;
  readonly rewrapped: number;
  /** Already on the current key, so nothing to do. */
  readonly current: number;
}

export async function rotateInstanceSecrets(
  pool: Pool,
  ring: KeyRing,
): Promise<RotationReport> {
  const db = drizzle(pool);

  const rows = await db
    .select({
      key: systemSettings.key,
      ciphertext: systemSettings.secretCiphertext,
      dataKey: systemSettings.secretDataKey,
      keyId: systemSettings.secretKeyId,
    })
    .from(systemSettings);

  const sealed = rows.filter(
    (row) =>
      row.ciphertext !== null && row.dataKey !== null && row.keyId !== null,
  );

  let rewrapped = 0;
  let current = 0;

  for (const row of sealed) {
    if (row.keyId === ring.current.id) {
      current += 1;
      continue;
    }

    const next = rewrapSecret(ring, {
      ciphertext: row.ciphertext as string,
      dataKey: row.dataKey as string,
      keyId: row.keyId as string,
    });

    // openokr:allow-mutation: rotation rewrites the wrapping of an instance
    // secret, not workspace data. There is no workspace whose audit chain this
    // could join, and the value itself does not change: only which root key
    // can unwrap its data key.
    await withInstanceAdmin(db, (tx) =>
      tx
        .update(systemSettings)
        .set({
          secretDataKey: next.dataKey,
          secretKeyId: next.keyId,
          updatedAt: new Date(),
        })
        .where(eq(systemSettings.key, row.key)),
    );
    rewrapped += 1;
  }

  return { examined: sealed.length, rewrapped, current };
}
