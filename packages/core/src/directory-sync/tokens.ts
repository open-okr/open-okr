/**
 * SCIM bearer token management (P8-T08).
 *
 * Each workspace generates one SCIM token, through the `directory.createToken`
 * action, which is audited. The identity provider sends it
 * on every request. The token is hashed (SHA-256) at rest, following the
 * session-token pattern from P1-T04.
 *
 * **Both halves run under the tenant floor** (P8-T07a). Creation knows its
 * workspace and sets it; resolution does not, and reaches exactly the row
 * whose digest it already holds through `app.directory_token_hash`. The first
 * version of this module ran both unscoped, so creation violated the policy's
 * check and resolution returned nothing, which answered every SCIM request
 * with 401.
 */

import { createHash, randomBytes } from "node:crypto";
import { withDirectoryToken } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

/** Hashes a token for storage. Same algorithm as session tokens. */
export function hashSCIMToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generates a random bearer token, 32 bytes hex-encoded. */
export function generateSCIMToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Resolves a SCIM bearer token to a workspace id.
 * Returns null if the token is unknown, revoked, or expired.
 *
 * The caller has a bearer token and nothing else, so which workspace it
 * provisions into is the question rather than the context. The digest names
 * the one row this transaction may see, and the workspace it answers with is
 * what the provisioning that follows is scoped to.
 */
export async function resolveToken(
  pool: Pool,
  token: string,
): Promise<{ workspaceId: string; tokenId: string } | null> {
  const hash = hashSCIMToken(token);
  const { rows } = await withDirectoryToken(drizzle(pool), hash, (tx) =>
    tx.execute<{ workspace_id: string; id: string }>(sql`
      select workspace_id, id
        from directory_sync_tokens
       where token_hash = ${hash}
         and revoked_at is null
         and (expires_at is null or expires_at > now())`),
  );
  const row = rows[0];
  if (!row) return null;
  return { workspaceId: row.workspace_id, tokenId: row.id };
}
