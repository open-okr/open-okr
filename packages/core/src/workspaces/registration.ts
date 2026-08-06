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
 * P1-T09 added the stored override this file anticipated. `registration.policy`
 * holds 'auto', 'open' or 'invite_only'. 'auto' is the default and is the
 * computed answer above; the other two fix the policy whatever the instance
 * looks like, which is what an operator running a public instance or a closed
 * one actually wants.
 */
import type { Pool } from "pg";
import { readSetting } from "../secrets/instance-settings.ts";

/** The computed half: an instance nobody has claimed is open. */
async function isUnclaimed(pool: Pool): Promise<boolean> {
  const result = await pool.query("select 1 from users limit 1");
  return result.rowCount === 0;
}

export async function isRegistrationOpen(pool: Pool): Promise<boolean> {
  const stored = await readSetting(pool, "registration.policy");

  if (stored === "open") {
    return true;
  }
  if (stored === "invite_only") {
    return false;
  }
  // 'auto', an unset value, or anything unrecognised. An unrecognised policy
  // falls back to the safe computed answer rather than throwing: a typo in a
  // settings row must not take the sign-in page down.
  return isUnclaimed(pool);
}

/**
 * What a refused registration says. It names the way in rather than only the
 * way out, because somebody hitting this is usually a colleague who was told
 * to sign up (screen S-35).
 */
export const REGISTRATION_CLOSED_MESSAGE =
  "This instance is invitation-only. Ask a workspace admin to invite you.";
