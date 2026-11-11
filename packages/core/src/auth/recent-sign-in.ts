/**
 * What "a recent sign-in" means (docs/design/account-self-service.md D2,
 * plan 0.8.0 Y3).
 *
 * A session created in the last ten minutes. Setting a password on an account
 * that has none asks for one, and so do the email change for an account with
 * no password (Y4) and deleting your own account (Y7).
 *
 * **Not Better Auth's `freshAge`.** That is a day, and it also guards
 * `/unlink-account`, so changing it would move other things. A stolen session
 * cookie under a day old must not be enough to give a single-sign-on account a
 * password that outlives its removal at the identity provider.
 *
 * A session's `createdAt` is when somebody signed in. Better Auth refreshes the
 * expiry of a live session once a day and never touches when it began.
 *
 * A constant, not a setting: a security floor nobody should have to choose
 * (design §7).
 */

export const RECENT_SIGN_IN_SECONDS = 10 * 60;

/** Whether this session began within `RECENT_SIGN_IN_SECONDS` of `now`. */
export function signedInRecently(
  session: { readonly createdAt: Date | string },
  now: Date = new Date(),
): boolean {
  const began = new Date(session.createdAt).getTime();
  if (Number.isNaN(began)) {
    return false;
  }
  return now.getTime() - began < RECENT_SIGN_IN_SECONDS * 1000;
}
