import { BROWSER_TIMEZONE_COOKIE, matchListedTimezone } from "@openokr/formats";
import { cookieValue } from "../invitations/pending.ts";

/**
 * The timezone the request's browser reported, as a listed zone, or
 * `undefined` (TECHNICAL-PLAN §4.14, docs/design/browser-timezone.md).
 *
 * The browser writes `openokr_tz`; this reads it wherever a workspace or a
 * member is made. Untrusted, so anything that does not match a listed zone is
 * dropped and the specified fallback applies. It never throws: the callers
 * are the sign-up hook and the first page a person sees, and a bad cookie
 * must not stop either.
 */
export function browserTimezoneFromCookies(
  header: string | null,
): string | undefined {
  const reported = cookieValue(header, BROWSER_TIMEZONE_COOKIE);
  return reported ? (matchListedTimezone(reported) ?? undefined) : undefined;
}
