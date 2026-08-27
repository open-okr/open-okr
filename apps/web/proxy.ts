import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * The first gate in front of protected routes, plus the security response
 * headers every response carries (TECHNICAL-PLAN §8.2, P2-T09).
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the
 * behaviour is the same.
 *
 * The session check only looks for a cookie, which is a cheap redirect for
 * the common signed-out case, not an authorisation decision: proxy code runs
 * before rendering and must not depend on the database. The page itself
 * still calls `requireSession`, which validates the session for real. A
 * forged cookie gets past here and is refused there.
 *
 * Every response carries a strict content security policy with a fresh nonce,
 * plus transport, frame and referrer policy. Nonce CSP needs every page
 * dynamically rendered, which every page under this proxy already is:
 * `requireSession`/`requireWorkspace` call `headers()`, a dynamic API, before
 * anything else.
 *
 * Three directives differ in development, each for a stated reason on
 * `buildContentSecurityPolicy` below: `'unsafe-eval'` is added because React
 * needs `eval` to reconstruct server error stacks and neither React nor Next
 * uses it in production, `style-src` accepts inline styles the dev bundler
 * injects, and `upgrade-insecure-requests` is left out because it makes every
 * development host other than `localhost` unusable.
 */
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/backup-code",
  "/api/auth",
  // The first-run wizard runs before anybody has an account, so it cannot sit
  // behind a session. Its own layout refuses once the instance is configured,
  // which is a database question and therefore not one this file can ask.
  "/setup",
  // The container health check has no session and must answer while the
  // instance is still starting.
  "/api/health",
  // **Two surfaces that authenticate themselves, and must not be gated by a
  // cookie (P5-T07a).** A cookie is not the only credential this product
  // accepts, and this list was written when it was.
  //
  // The versioned REST surface resolves a bearer token and refuses without
  // one. A redirect here would answer every API call with the sign-in page at
  // status 200, which is what an HTTP client sees as success.
  "/api/v1",
  // The inbound channel webhooks verify a provider signature or shared secret
  // over the raw bytes before reading them at all. Slack and Telegram send no
  // cookie, so before this line every inbound message was answered with a 307
  // to /sign-in and nothing the channel layer does could ever have run in a
  // deployed instance. The unit tests call the handler directly and could not
  // see it; found while writing this task's first end-to-end request.
  "/api/channels",
];

/**
 * A fresh nonce and the CSP header built around it, one pair per request.
 *
 * **`upgrade-insecure-requests` is production-only.** It tells the browser to
 * fetch every subresource over https, which is right for a deployed instance and
 * unusable in development: browsers exempt `localhost` and `127.0.0.1` from the
 * upgrade and nothing else. So a developer serving the app on any other name
 * over http gets every stylesheet and script requested over https, refused, and
 * a page rendered as raw HTML with no styling at all.
 *
 * Two ordinary development setups hit that. A local domain through a reverse
 * proxy (`http://openokr.test`), and testing on a real phone over the LAN
 * address (`http://192.168.1.20:3000`), which is the only way to check the
 * mobile tab bar on a real device. Neither is exotic and both were broken.
 *
 * Production is untouched: the directive is still sent whenever `NODE_ENV` is
 * not development, which is what the Docker and Helm targets both run as.
 */
function buildContentSecurityPolicy(): { nonce: string; header: string } {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`};
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';${isDev ? "" : "\n    upgrade-insecure-requests;"}
  `;
  return { nonce, header: cspHeader.replace(/\s{2,}/g, " ").trim() };
}

function applySecurityHeaders(
  response: NextResponse,
  contentSecurityPolicy: string,
): NextResponse {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  // CSP's own `frame-ancestors 'none'` already refuses framing in a
  // CSP-aware browser; this is the pre-CSP fallback for one that only reads
  // the older header.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Harmless without HTTPS (browsers ignore it over plain HTTP); a reverse
  // proxy in front of the app cannot add this on the app's behalf without
  // knowing the app intends every response to opt in.
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains",
  );
  return response;
}

/** `NextResponse.next()`, carrying the nonce forward on the request too —
 * that is what lets a server component read it back via `headers()` for its
 * own inline scripts, and what Next parses off the response CSP header to
 * nonce its own framework and page scripts automatically. */
function next(request: NextRequest): NextResponse {
  const { nonce, header } = buildContentSecurityPolicy();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // The path, forwarded the same way, so the shell can mark the navigation item
  // the reader is actually on. A server component has no `usePathname`, and
  // making the whole sidebar a client component to learn one string would send
  // the navigation to the browser for no other reason.
  requestHeaders.set("x-openokr-path", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", header);

  return applySecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    header,
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return next(request);
  }

  if (getSessionCookie(request)) {
    return next(request);
  }

  const signIn = new URL("/sign-in", request.url);
  // Where to return to once they are in, so a shared link still works.
  signIn.searchParams.set("next", `${pathname}${search}`);
  const { header } = buildContentSecurityPolicy();
  return applySecurityHeaders(NextResponse.redirect(signIn), header);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
