import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "../proxy";

/**
 * The gate in front of protected routes. It is a redirect for the common
 * signed-out case, not an authorisation decision: the page still validates
 * the session against the database.
 */

const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });

/** A cookie shaped like Better Auth's, which is all the proxy inspects. */
const SESSION_COOKIE = "better-auth.session_token=token.signature";

describe("proxy", () => {
  it("sends an unauthenticated visitor to sign in", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/sign-in");
  });

  it("remembers where they were going", () => {
    const response = proxy(request("/account/security?tab=passkeys"));
    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get("next")).toBe(
      "/account/security?tab=passkeys",
    );
  });

  it("lets a request with a session cookie through", () => {
    const response = proxy(request("/", SESSION_COOKIE));
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves the authentication pages public", () => {
    for (const path of [
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/reset-password?token=abc",
      "/backup-code",
    ]) {
      const response = proxy(request(path));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("leaves the authentication endpoints reachable", () => {
    // Redirecting these would break sign-in itself.
    const response = proxy(request("/api/auth/sign-in/email"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("protects everything else", () => {
    for (const path of ["/", "/account/security", "/goals", "/api/goals"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
    }
  });

  it("skips Next's own assets", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico).*)",
    ]);
  });
});
