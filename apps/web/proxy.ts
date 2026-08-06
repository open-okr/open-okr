import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * The first gate in front of protected routes.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the
 * behaviour is the same.
 *
 * This only checks that a session cookie is present, which is a cheap
 * redirect for the common signed-out case, not an authorisation decision:
 * proxy code runs before rendering and must not depend on the database. The
 * page itself still calls `requireSession`, which validates the session for
 * real. A forged cookie gets past here and is refused there.
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

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (getSessionCookie(request)) {
    return NextResponse.next();
  }

  const signIn = new URL("/sign-in", request.url);
  // Where to return to once they are in, so a shared link still works.
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
