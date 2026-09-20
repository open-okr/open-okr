/**
 * SCIM bearer token management (P8-T08).
 *
 * Each workspace generates one SCIM token. The identity provider sends it
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
import { withDirectoryToken, withWorkspace } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

/** Hashes a token for storage. Same algorithm as session tokens. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generates a random bearer token, 32 bytes hex-encoded. */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Creates a SCIM token for a workspace. Returns the plaintext token once.
 * Revokes any existing live token for the workspace first.
 */
export async function createSCIMToken(
  pool: Pool,
  workspaceId: string,
  label?: string,
): Promise<{ token: string; id: string }> {
  const plaintext = generateToken();
  const hash = hashToken(plaintext);

  const row = await withWorkspace(drizzle(pool), workspaceId, async (tx) => {
    // openokr:allow-mutation: token revocation and creation are an
    // infrastructure operation with no acting member. The admin endpoint
    // that calls this is access-checked, and the sync log records the
    // operational fact.
    await tx.execute(sql`
      update directory_sync_tokens
         set revoked_at = now()
       where workspace_id = ${workspaceId}
         and revoked_at is null`);

    // openokr:allow-mutation: the same operation, the same transaction. The
    // revocation above and this insert are the one live token moving, and
    // splitting them would leave a workspace with none.
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into directory_sync_tokens (workspace_id, token_hash, label)
      values (${workspaceId}, ${hash}, ${label ?? "SCIM token"})
      returning id`);
    return inserted.rows[0];
  });

  if (!row) throw new Error("Token insert returned no row");
  return { token: plaintext, id: row.id };
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
  const hash = hashToken(token);
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
