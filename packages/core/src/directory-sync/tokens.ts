/**
 * SCIM bearer token management (P8-T08).
 *
 * Each workspace generates one SCIM token. The identity provider sends it
 * on every request. The token is hashed (SHA-256) at rest, following the
 * session-token pattern from P1-T04.
 */
import { createHash, randomBytes } from "node:crypto";
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // openokr:allow-mutation: token revocation and creation are an
    // infrastructure operation with no acting member. The admin endpoint
    // that calls this is access-checked, and the sync log records the
    // operational fact.
    await client.query(
      `UPDATE directory_sync_tokens
          SET revoked_at = now()
        WHERE workspace_id = $1
          AND revoked_at IS NULL`,
      [workspaceId],
    );

    // Insert the new token.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO directory_sync_tokens (workspace_id, token_hash, label)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [workspaceId, hash, label ?? "SCIM token"],
    );

    await client.query("COMMIT");
    const row = rows[0];
    if (!row) throw new Error("Token insert returned no row");
    return { token: plaintext, id: row.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resolves a SCIM bearer token to a workspace id.
 * Returns null if the token is unknown, revoked, or expired.
 */
export async function resolveToken(
  pool: Pool,
  token: string,
): Promise<{ workspaceId: string; tokenId: string } | null> {
  const hash = hashToken(token);
  const { rows } = await pool.query<{
    workspace_id: string;
    id: string;
  }>(
    `SELECT workspace_id, id
       FROM directory_sync_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [hash],
  );
  const row = rows[0];
  if (!row) return null;
  return { workspaceId: row.workspace_id, tokenId: row.id };
}
