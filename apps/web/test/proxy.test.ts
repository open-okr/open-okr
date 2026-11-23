import { resetEnvCache } from "@openokr/config";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://openokr@localhost/openokr_test");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("proxy CSP transport", () => {
  it.each([
    ["http://openokr.example:8080", "https", false],
    ["https://openokr.example", "http", true],
    [undefined, "https", false],
    ["ftp://openokr.example", "http", true],
  ] as const)(
    "uses the configured public origin %s on pages and redirects",
    (origin, offeredScheme, upgrades) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "a-test-secret-of-sufficient-length-for-signing",
      );
      vi.stubEnv("BETTER_AUTH_URL", origin);

      const headers = {
        host: "internal.example",
        forwarded: `host=offered.example;proto=${offeredScheme}`,
        "x-forwarded-proto": offeredScheme,
      };
      const url = `${offeredScheme}://upstream.example:3000`;
      const page = proxy(new NextRequest(`${url}/sign-in`, { headers }));
      const redirect = proxy(
        new NextRequest(`${url}/goals?tab=all`, { headers }),
      );

      const policy = page.headers.get("content-security-policy");
      const nonce = page.headers.get("x-middleware-request-x-nonce");
      expect(nonce).toBeTruthy();
      expect(policy).toContain(
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic';`,
      );
      expect(policy).toContain(`style-src 'self' 'nonce-${nonce}';`);
      expect(policy).toContain("frame-ancestors 'none';");
      expect(
        page.headers.get("x-middleware-request-content-security-policy"),
      ).toBe(policy);
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(page.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(page.headers.get("strict-transport-security")).toBe(
        "max-age=63072000; includeSubDomains",
      );
      expect(policy?.includes("upgrade-insecure-requests;")).toBe(upgrades);

      expect(redirect.status).toBe(307);
      const location = new URL(redirect.headers.get("location") ?? "");
      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("next")).toBe("/goals?tab=all");
      const redirectPolicy = redirect.headers.get("content-security-policy");
      expect(redirectPolicy?.includes("upgrade-insecure-requests;")).toBe(
        upgrades,
      );
      expect(redirectPolicy).toContain("'strict-dynamic'");
      expect(redirectPolicy).not.toContain(`'nonce-${nonce}'`);
    },
  );

  it("omits upgrades and keeps development allowances with a public HTTPS origin", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_URL", "https://openokr.example");
    const policy = proxy(request("/sign-in")).headers.get(
      "content-security-policy",
    );
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
  });
});

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

  it("serves the sign-in page's vendored font assets without a session", () => {
    for (const path of [
      "/fonts/noto-sans-arabic/fonts.css",
      "/fonts/noto-sans-arabic/noto-sans-arabic-arabic-wght-normal.woff2",
      "/fonts/noto-sans-sc/fonts.css",
      "/fonts/noto-sans-sc/noto-sans-sc-4-wght-normal.woff2",
    ]) {
      expect(proxy(request(path)).headers.get("location")).toBeNull();
    }
    expect(proxy(request("/fonts/pdf/NotoSansSC-Regular.otf")).status).toBe(
      307,
    );
  });

  it("leaves an invitation reachable, because the invitee has no account", () => {
    // **The one dead end this gate created.** `/join` was behind the session
    // cookie until P6-G06b, so every invitee was sent to sign in, which is the
    // single thing somebody without an account cannot do. The token in the
    // address is the credential, the same way a bearer token is on the REST
    // surface, and the page refuses an invalid one itself.
    //
    // Caught by the end-to-end spec on its first run rather than by reading.
    const response = proxy(request("/join/some-token"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves the authentication endpoints reachable", () => {
    // Redirecting these would break sign-in itself.
    const response = proxy(request("/api/auth/sign-in/email"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves the surfaces that carry their own credential reachable", () => {
    // The REST surface authenticates a bearer token and the channel webhooks
    // verify a provider signature. Neither sends a cookie, and a redirect
    // would answer an API client with the sign-in page at status 200.
    for (const path of [
      "/api/v1",
      "/api/v1/goals/list",
      "/api/channels/slack",
      "/api/channels/telegram/123456",
    ]) {
      const response = proxy(request(path));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  // docs/design/metrics-scrape-token.md D5, plan 0.7.0 B3: a scrape carries a
  // bearer token and no cookie, and the route decides, answering not-found
  // without a valid token or session.
  it("lets a metrics scrape reach the route, which decides", () => {
    const response = proxy(request("/api/metrics"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves the agent setup instructions reachable, because the agent has no session", () => {
    // docs/design/agent-setup-prompt.md §9.2.
    const response = proxy(request("/agent-setup/prompt.md"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("protects everything else", () => {
    for (const path of ["/", "/account/security", "/goals", "/api/goals"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
    }
  });

  it("skips Next's own assets and the tab icons", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
    ]);
  });
});
