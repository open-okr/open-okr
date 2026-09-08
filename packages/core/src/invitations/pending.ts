/**
 * The invitation a visitor is part-way through accepting (P6-G06b).
 *
 * **Registration on a closed instance is refused inside Better Auth**, in the
 * `user.create.before` hook, and P1-T06 chose that deliberately: refusing at
 * the route would leave every future social or single-sign-on path free to
 * reopen registration by not knowing the rule. So the exception a valid
 * invitation grants has to be visible from inside that hook, which sees the
 * request and not the page that sent it.
 *
 * A cookie is how the token gets there. `/join/<token>` sets it before sending
 * a signed-out visitor to sign up, and the hook reads it back. The token is
 * already in that visitor's address bar, so putting it in an `httpOnly` cookie
 * reveals nothing new and keeps it away from script on the page.
 *
 * Pure, and its own module, so the parsing is tested without a browser and the
 * name is written once for the route that sets it and the hook that reads it.
 */

/** The cookie `/join` sets and the auth hook reads. */
export const INVITE_COOKIE = "openokr_invite";

/**
 * How long the cookie lives.
 *
 * Long enough to read a page, choose a password and confirm an address; short
 * enough that a shared machine does not carry somebody else's invitation into
 * tomorrow. It is cleared as soon as it is used either way.
 */
export const INVITE_COOKIE_MAX_AGE_SECONDS = 30 * 60;

/**
 * The token from a `Cookie` header, or null.
 *
 * Written by hand rather than with a parser: this reads one name out of a
 * header the platform gives as a string, in a package that may not depend on a
 * framework. A malformed header yields null rather than throwing, because the
 * caller is an authentication hook and a crash there is a sign-up nobody can
 * complete.
 */
export function inviteTokenFromCookies(header: string | null): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() !== INVITE_COOKIE) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    if (value === "") {
      return null;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      // A cookie value that is not valid percent-encoding is not a token this
      // product issued. Refused rather than passed on raw.
      return null;
    }
  }
  return null;
}

/**
 * The `Cookie` header on a request, wherever this runtime keeps it.
 *
 * Better Auth hands the hook a `GenericEndpointContext`, which carries
 * `headers` on some paths and a whole `request` on others depending on which
 * endpoint ran. Both are read rather than one, because a sign-up that silently
 * stopped honouring invitations on one path is the failure this whole task is
 * about.
 *
 * The header rather than the token, so the one function that decides whether a
 * request may register takes the same argument from the hook and from the page,
 * and neither has to know the cookie's name.
 */
export function cookieHeaderFrom(
  source:
    | {
        readonly headers?: { get(name: string): string | null } | undefined;
        readonly request?:
          | { readonly headers: { get(name: string): string | null } }
          | undefined;
      }
    | null
    | undefined,
): string | null {
  if (!source) {
    return null;
  }
  return (
    source.headers?.get("cookie") ??
    source.request?.headers.get("cookie") ??
    null
  );
}
