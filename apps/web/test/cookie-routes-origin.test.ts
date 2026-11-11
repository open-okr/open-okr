/**
 * Every route handler that changes something on the session cookie runs the
 * cross-site check (H-A). A route added tomorrow that skips it fails here, so
 * nobody has to remember. A route that carries no cookie goes on the list below
 * with the reason.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..", "app");

/** Path prefixes (from `app/`) whose handlers carry no session cookie. */
const NO_COOKIE: readonly string[] = [
  "api/v1/[[...path]]", // bearer token
  "api/v1/cli/device", // device-flow codes, no cookie
  "api/scim", // SCIM bearer token
  "api/auth", // Better Auth's own origin check
  "api/mcp", // bearer token, own origin check
  "api/billing/webhook", // signed webhook
  "api/channels", // signed webhooks
];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });

const MUTATING =
  /export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b/;

describe("cookie-authenticated route handlers", () => {
  const routes = walk(APP)
    .map((file) => ({
      file,
      path: relative(APP, file).replaceAll("\\", "/"),
      source: readFileSync(file, "utf8"),
    }))
    .filter(({ source }) => MUTATING.test(source))
    .filter(
      ({ path }) => !NO_COOKIE.some((prefix) => path.startsWith(`${prefix}/`)),
    );

  it("finds the routes it is meant to guard", () => {
    expect(routes.map((route) => route.path)).toContain(
      "api/v1/admin/sso/route.ts",
    );
  });

  for (const route of routes) {
    it(`${route.path} runs the cross-site check`, () => {
      expect(route.source).toMatch(/refuseCrossSite|sameOriginAllowed/);
    });
  }
});
