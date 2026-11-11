import { instanceIssuer } from "./issuer";

/**
 * The cross-site check for route handlers that act on the session cookie.
 *
 * A browser attaches the cookie to a request that another site caused, so a
 * handler that changes something on the strength of the cookie alone can be
 * driven from any page the person visits. Server actions are checked by Next.js
 * itself, and Better Auth checks its own handler. This is the same rule for the
 * route handlers in between.
 *
 * **The rule.** The `Origin` header, or the `Referer` when there is no `Origin`,
 * names the instance, else 403. A request with neither is a program rather than
 * a page (a browser sends `Origin` on every cross-site POST), so it passes: the
 * cookie is what a browser carries, and a browser always says where it came from.
 *
 * **What "the instance" means.** The configured address, or the host the request
 * itself arrived at. The second covers an instance reached through a proxy or a
 * second hostname without anybody having to configure anything. A page on another
 * site cannot make a victim's browser send a `Host` that is not the one it is
 * talking to, so it cannot use this to pass.
 *
 * Routes that carry no cookie (bearer-token REST, webhooks, MCP, SCIM) do not
 * call this.
 */
export function sameOriginAllowed(
  headers: Headers,
  issuer: string = instanceIssuer(),
): boolean {
  const claimed = claimedOrigin(headers);
  if (claimed === null) {
    return true;
  }
  if (claimed === undefined) {
    // Present but unreadable, or the literal "null" a sandboxed page sends.
    return false;
  }
  try {
    if (claimed.origin === new URL(issuer).origin) {
      return true;
    }
  } catch {
    // An unreadable configured address falls through to the host comparison.
  }
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  return host !== undefined && host !== "" && claimed.host === host;
}

/** `null` when the request says nothing, `undefined` when what it says is unusable. */
function claimedOrigin(headers: Headers): URL | null | undefined {
  const origin = headers.get("origin");
  const source =
    origin !== null && origin !== "" ? origin : headers.get("referer");
  if (source === null || source === "") {
    return null;
  }
  try {
    return new URL(source);
  } catch {
    return undefined;
  }
}

/** A plain 403 for a request another site caused, or `null` to go on. */
export function refuseCrossSite(request: Request): Response | null {
  if (sameOriginAllowed(request.headers)) {
    return null;
  }
  return new Response("Forbidden", {
    status: 403,
    headers: { "cache-control": "no-store" },
  });
}
