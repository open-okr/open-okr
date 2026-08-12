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
 * The headers are unconditional: a strict content security policy with a
 * fresh nonce per response (`'unsafe-eval'` only in development, where React
 * needs `eval` to reconstruct server error stacks — neither React nor Next
 * uses it in production), plus transport, frame and referrer policy. Nonce
 * CSP needs every page dynamically rendered, which every page under this
 * proxy already is: `requireSession`/`requireWorkspace` call `headers()`, a
 * dynamic API, before anything else.
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
];

/** A fresh nonce and the CSP header built around it, one pair per request. */
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
    frame-ancestors 'none';
    upgrade-insecure-requests;
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
