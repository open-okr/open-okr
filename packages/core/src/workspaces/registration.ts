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
import { addressMayAccept, previewInvite } from "../invitations/preview.ts";
import { readSetting } from "../secrets/instance-settings.ts";
import { isCloudEnabled } from "../tenancy/index.ts";

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
  //
  // **A cloud instance is open however many people have claimed it**
  // (P8-T02b). The computed answer above exists because a self-hosted
  // instance belongs to whoever set it up, so the first registration closing
  // the door behind itself is right. A cloud belongs to nobody, and the same
  // rule there would mean exactly one customer ever signed up.
  //
  // This reads the instance's own flag, not a tenant row, which is why it is
  // allowed on a product path at all: `cloud.enabled` is a fact about the
  // deployment, and `tenants` is vendor knowledge about a customer. The
  // boundary gate draws the line in the same place.
  if (await isCloudEnabled(pool)) {
    return true;
  }
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
 *
 * **`email` is optional because one caller has one and the other never can.**
 * The sign-up page asks before anybody has typed an address, to decide
 * whether to render the form at all, so it asks the token-only question: is
 * there something here worth a form. Better Auth's own `user.create.before`
 * asks after the address exists, and that is the call that actually admits
 * somebody, so it is the one required to pass it.
 *
 * **Without it, a token for one address opened registration for any address**
 * (manual UAT, 29 September 2026, M04-03). `registrationOpenOrInvited`
 * checked only whether *some* usable token sat in the cookie, never which
 * email the token was for, so a personal invitation for `a@x` let a visitor
 * register `b@x` instead: the `before` hook let it through, and `after`'s
 * `acceptPendingInvitation` then refused to join a workspace it was never
 * addressed to, silently, and the account fell through to its own fresh
 * workspace. A single-use invitation for one address had become a skeleton
 * key for a closed instance. `addressMayAccept`, the function
 * `invitations.acceptLink` already uses for the identical decision, closes
 * that gap here too rather than a third copy of the same rule.
 */
export async function registrationOpenOrInvited(
  pool: Pool,
  cookieHeader: string | null,
  email?: string,
): Promise<boolean> {
  if (await isRegistrationOpen(pool)) {
    return true;
  }
  const token = inviteTokenFromCookies(cookieHeader);
  if (!token) {
    return false;
  }
  const invitation = await previewInvite(pool, { token, now: new Date() });
  if (invitation.kind !== "usable") {
    return false;
  }
  return email === undefined || addressMayAccept(invitation, email);
}
