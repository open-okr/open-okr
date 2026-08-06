/**
 * The registration policy (TECHNICAL-PLAN §4.14, instance scope).
 *
 * "Open until the first admin exists, then invitation-only." There is no admin
 * role yet, because roles are access bindings and those arrive with P2-T01. So
 * the question is asked the way the plan means it: an instance nobody has
 * claimed is open, and a claimed one is closed.
 *
 * The count is over `users`, not `workspaces`. `users` is global and carries no
 * row-level security, so it answers truthfully; a count over `workspaces` runs
 * under the tenant floor and would report zero on every unscoped connection,
 * which would leave registration open forever.
 *
 * This is computed rather than stored. When `system_settings` arrives with the
 * first-run wizard (P1-T09), the stored flag becomes the override and this
 * stays the default it falls back to.
 */
import type { Pool } from "pg";

export async function isRegistrationOpen(pool: Pool): Promise<boolean> {
  const result = await pool.query("select 1 from users limit 1");
  return result.rowCount === 0;
}

/**
 * What a refused registration says. It names the way in rather than only the
 * way out, because somebody hitting this is usually a colleague who was told
 * to sign up (screen S-35).
 */
export const REGISTRATION_CLOSED_MESSAGE =
  "This instance is invitation-only. Ask a workspace admin to invite you.";
