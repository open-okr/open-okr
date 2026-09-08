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
import { inviteTokenFromCookies } from "../invitations/pending.ts";
import { previewInvite } from "../invitations/preview.ts";
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

/**
 * Whether this request may register, invitation included (P6-G06b).
 *
 * **The hook and the page have to agree, and they did not.** P1-T06 refuses
 * user creation inside Better Auth's own `user.create.before`, deliberately,
 * so no future sign-in path can reopen registration by not knowing the rule.
 * P6-G06b taught that hook about invitations and left the sign-up page asking
 * the narrower question, so a closed instance showed an invitee "Registration
 * is closed" and never rendered a form the hook would have accepted. The
 * invitation was redeemable and unreachable at the same time.
 *
 * Found by the end-to-end spec, which pressed the button and waited for a name
 * field that was never going to appear.
 *
 * One function, both callers. The cookie is the same one `/join` sets, and a
 * token that is not usable is the same as no token at all.
 */
export async function registrationOpenOrInvited(
  pool: Pool,
  cookieHeader: string | null,
): Promise<boolean> {
  if (await isRegistrationOpen(pool)) {
    return true;
  }
  const token = inviteTokenFromCookies(cookieHeader);
  if (!token) {
    return false;
  }
  const invitation = await previewInvite(pool, { token, now: new Date() });
  return invitation.kind === "usable";
}
