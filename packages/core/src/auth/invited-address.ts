/**
 * An invited address arrives confirmed (plan 0.8.0 S5,
 * docs/design/email-verification.md §12, approved by Akmal on 11 November
 * 2026).
 *
 * A personal invitation is sent to one address, and opening its link proves
 * that inbox exactly as a confirmation link would. So a person who signs up
 * through one with that same address is created confirmed, and an
 * unconfirmed account that accepts one sent to its own address is confirmed
 * then (S5-Q2). A shared workspace link names no address and can be
 * forwarded, so it proves nothing about one inbox and confirms nothing.
 *
 * One predicate for both moments, so the sign-up hook and the join page can
 * never disagree about which invitation counts.
 */
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import { inviteTokenFromCookies } from "../invitations/pending.ts";
import {
  type InviteResolution,
  previewInvite,
} from "../invitations/preview.ts";

/** The chain's action, shared with a confirmation link and a reset. */
const VERIFIED_ACTION = "auth.email_verified";

/**
 * The outbox topic that confirms an invited address after an acceptance on any
 * surface (plan 0.8.1 S5-R, email-verification.md §13). The action decides in
 * its own transaction; the relay confirms through Better Auth (D14).
 */
export const CONFIRM_INVITED_ADDRESS_TOPIC = "auth.confirm_invited_address";

/**
 * Whether this invitation proves this address: a usable personal invitation
 * issued to it, compared without case or surrounding spaces, as acceptance
 * compares them (`addressMayAccept`).
 */
export function invitationConfirms(
  invitation: InviteResolution,
  email: string,
): boolean {
  return (
    invitation.kind === "usable" &&
    invitation.mode === "personal" &&
    invitation.email !== null &&
    invitation.email.trim().toLowerCase() === email.trim().toLowerCase()
  );
}

/**
 * Whether the invitation a sign-up carries in its cookie proves the address
 * it is signing up with. Read before the invitation is accepted, since
 * accepting a single-use link uses it up.
 */
export async function invitationInCookieConfirms(
  pool: Pool,
  cookieHeader: string | null,
  email: string,
): Promise<boolean> {
  const token = inviteTokenFromCookies(cookieHeader);
  if (token === null) {
    return false;
  }
  return invitationConfirms(
    await previewInvite(pool, { token, now: new Date() }),
    email,
  );
}

/** The instance chain's row for an address an invitation confirmed. */
export async function recordConfirmedByInvitation(
  pool: Pool,
  userId: string,
): Promise<void> {
  await recordInstanceAuditEvent(pool, {
    action: VERIFIED_ACTION,
    payload: { userId, via: "invitation" },
  });
}

/** The part of Better Auth's instance this needs: its own user writer. */
export interface UserWriter {
  readonly $context: Promise<{
    readonly internalAdapter: {
      updateUser(
        userId: string,
        data: { emailVerified: boolean },
      ): Promise<unknown>;
    };
  }>;
}

/**
 * S5-Q2: a signed-in account accepted a personal invitation. When it was sent
 * to this account's own address and the address is not yet confirmed, the
 * address is confirmed now. True when it was.
 *
 * Through Better Auth's own adapter, as a completed reset confirms an address
 * (email-verification.md D14), so its user-update hooks run, and never by
 * direct SQL.
 */
export async function confirmByAcceptedInvitation(
  auth: UserWriter,
  pool: Pool,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly invitation: InviteResolution;
  },
): Promise<boolean> {
  if (
    input.emailVerified ||
    !invitationConfirms(input.invitation, input.email)
  ) {
    return false;
  }
  const context = await auth.$context;
  await context.internalAdapter.updateUser(input.userId, {
    emailVerified: true,
  });
  await recordConfirmedByInvitation(pool, input.userId);
  return true;
}

/**
 * Confirms an account's address through Better Auth's own adapter, so its
 * user-update hooks run (D14). What the relay is given for
 * `CONFIRM_INVITED_ADDRESS_TOPIC`, built by the host that holds Better Auth.
 */
export function confirmAddressThrough(
  auth: UserWriter,
): (userId: string) => Promise<void> {
  return async (userId) => {
    const context = await auth.$context;
    await context.internalAdapter.updateUser(userId, { emailVerified: true });
  };
}
