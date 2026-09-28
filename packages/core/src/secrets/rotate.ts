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
 *
 * **Every sealed column, not only the instance's** (completeness review
 * H-25). This used to re-wrap `system_settings` and nothing else, while AI
 * provider keys, chat channel credentials and SSO client secrets are sealed
 * under the same root key in three workspace tables. `./openokr rotate-key`
 * removes the previous key once this returns, so every one of those became
 * unreadable after a routine rotation. Each workspace is now opened through
 * its own tenant setting, the way a request opens it, so this works under the
 * restricted application role as well as an admin connection. Soft-deleted
 * rows are included: a restore can bring them back, and they must still open.
 */
import {
  aiCredentials,
  channelConnections,
  includeDeleted,
  ssoConnections,
  systemSettings,
  withInstanceAdmin,
  withSystemScan,
  withWorkspace,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type KeyRing, rewrapSecret, type SealedSecret } from "./key-ring.ts";

export interface RotationReport {
  readonly examined: number;
  readonly rewrapped: number;
  /** Already on the current key, so nothing to do. */
  readonly current: number;
  /** How many of `examined` belong to a workspace rather than the instance. */
  readonly workspaceSecrets: number;
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

  const inWorkspaces = await rotateWorkspaceSecrets(db, ring);

  return {
    examined: sealed.length + inWorkspaces.examined,
    rewrapped: rewrapped + inWorkspaces.rewrapped,
    current: current + inWorkspaces.current,
    workspaceSecrets: inWorkspaces.examined,
  };
}

type Tally = { examined: number; rewrapped: number; current: number };

/** The three workspace tables that hold a sealed secret. */
async function rotateWorkspaceSecrets(
  db: ReturnType<typeof drizzle>,
  ring: KeyRing,
): Promise<Tally> {
  const tally: Tally = { examined: 0, rewrapped: 0, current: 0 };

  // Every workspace, deleted or not. A soft-deleted workspace can be restored,
  // and its credentials have to open when it is.
  const ids = await withSystemScan(db, (tx) =>
    tx
      .select({ id: workspaces.id })
      // openokr:allow-raw-read: root key rotation is an operator command with no acting member; it lists tenants to open each one.
      .from(workspaces)
      .where(includeDeleted(workspaces)),
  );

  /** The re-wrapped key, or null when the row is already current. */
  const next = (sealed: SealedSecret) => {
    tally.examined += 1;
    if (sealed.keyId === ring.current.id) {
      tally.current += 1;
      return null;
    }
    tally.rewrapped += 1;
    return rewrapSecret(ring, sealed);
  };

  for (const { id: workspaceId } of ids) {
    await withWorkspace(db, workspaceId, async (tx) => {
      const credentials = await tx
        .select({
          id: aiCredentials.id,
          ciphertext: aiCredentials.ciphertext,
          dataKey: aiCredentials.dataKey,
          keyId: aiCredentials.keyId,
        })
        .from(aiCredentials)
        .where(includeDeleted(aiCredentials));
      for (const row of credentials) {
        const wrapped = next(row);
        if (wrapped) {
          // openokr:allow-mutation: key rotation re-wraps a data key and changes no value; see rotateInstanceSecrets.
          await tx
            .update(aiCredentials)
            .set({ dataKey: wrapped.dataKey, keyId: wrapped.keyId })
            .where(includeDeleted(aiCredentials, eq(aiCredentials.id, row.id)));
        }
      }

      const connections = await tx
        .select({
          id: channelConnections.id,
          ciphertext: channelConnections.ciphertext,
          dataKey: channelConnections.dataKey,
          keyId: channelConnections.keyId,
        })
        .from(channelConnections)
        .where(includeDeleted(channelConnections));
      for (const row of connections) {
        const wrapped = next(row);
        if (wrapped) {
          // openokr:allow-mutation: key rotation re-wraps a data key and changes no value; see rotateInstanceSecrets.
          await tx
            .update(channelConnections)
            .set({ dataKey: wrapped.dataKey, keyId: wrapped.keyId })
            .where(
              includeDeleted(
                channelConnections,
                eq(channelConnections.id, row.id),
              ),
            );
        }
      }

      const sso = await tx
        .select({
          id: ssoConnections.id,
          ciphertext: ssoConnections.secretCiphertext,
          dataKey: ssoConnections.secretDataKey,
          keyId: ssoConnections.secretKeyId,
        })
        .from(ssoConnections)
        .where(includeDeleted(ssoConnections));
      for (const row of sso) {
        const wrapped = next(row);
        if (wrapped) {
          // openokr:allow-mutation: key rotation re-wraps a data key and changes no value; see rotateInstanceSecrets.
          await tx
            .update(ssoConnections)
            .set({
              secretDataKey: wrapped.dataKey,
              secretKeyId: wrapped.keyId,
            })
            .where(
              includeDeleted(ssoConnections, eq(ssoConnections.id, row.id)),
            );
        }
      }
    });
  }

  return tally;
}
