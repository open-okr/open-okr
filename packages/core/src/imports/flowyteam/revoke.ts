/**
 * Revokes a closed FlowyTeam connection's token at FlowyTeam, then forgets it
 * (docs/design/flowyteam-connect.md §4.1, disconnect).
 *
 * **Best effort, by design.** Disconnecting has already happened when this
 * runs: the row is closed and nothing here reads with its token again. What is
 * left is telling FlowyTeam, so the token stops working there too. An answer
 * that will not change by waiting (FlowyTeam refused, or has no revocation
 * endpoint) ends the attempt; no answer at all is retried by the relay.
 *
 * Either way the sealed token is cleared from the row once FlowyTeam has
 * answered, because a credential nobody will use again is not kept.
 */
import { importConnections, includeDeleted, withWorkspace } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { decryptSecret, type KeyRing } from "../../secrets/key-ring.ts";
import {
  type FlowyteamGateway,
  flowyteamClientCredentials,
} from "./connection.ts";

export type RevokeOutcome =
  | { readonly kind: "revoked" }
  | { readonly kind: "nothing"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "retry"; readonly reason: string };

export async function revokeFlowyteamConnection(input: {
  readonly pool: Pool;
  readonly ring: KeyRing;
  readonly revoke: FlowyteamGateway["revoke"];
  readonly workspaceId: string;
  readonly connectionId: string;
}): Promise<RevokeOutcome> {
  const db = drizzle(input.pool);
  const [row] = await withWorkspace(db, input.workspaceId, (tx) =>
    tx
      .select({
        baseUrl: importConnections.baseUrl,
        clientId: importConnections.clientId,
        deletedAt: importConnections.deletedAt,
        ciphertext: importConnections.tokenCiphertext,
        dataKey: importConnections.tokenDataKey,
        keyId: importConnections.tokenKeyId,
      })
      .from(importConnections)
      .where(
        includeDeleted(
          importConnections,
          eq(importConnections.id, input.connectionId),
        ),
      )
      .limit(1),
  );
  if (!row) {
    return { kind: "nothing", reason: "the connection is gone" };
  }
  if (!row.deletedAt) {
    // Only a closed row is revoked. A live one is somebody's connection.
    return { kind: "nothing", reason: "the connection is still live" };
  }
  if (!row.ciphertext || !row.dataKey || !row.keyId) {
    return { kind: "nothing", reason: "the token was already cleared" };
  }

  const accessToken = decryptSecret(input.ring, {
    ciphertext: row.ciphertext,
    dataKey: row.dataKey,
    keyId: row.keyId,
  });
  const credentials = await flowyteamClientCredentials(
    input.pool,
    input.ring,
    row.clientId,
  );
  const answer = await input.revoke({
    ...credentials,
    baseUrl: row.baseUrl,
    accessToken,
  });
  if (!answer.ok && answer.failure === "unreachable") {
    return { kind: "retry", reason: answer.detail };
  }

  // openokr:allow-mutation: the delivery side of the outbox, clearing a
  // credential the closed row no longer needs. Not a domain write; the
  // disconnect that closed the row carried the audit.
  await withWorkspace(db, input.workspaceId, (tx) =>
    tx
      .update(importConnections)
      .set({
        tokenCiphertext: null,
        tokenDataKey: null,
        tokenKeyId: null,
        updatedAt: new Date(),
      })
      .where(
        includeDeleted(
          importConnections,
          eq(importConnections.id, input.connectionId),
        ),
      ),
  );
  return answer.ok
    ? { kind: "revoked" }
    : { kind: "refused", reason: answer.detail };
}
