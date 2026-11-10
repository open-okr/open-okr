import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { AUTH_ENDPOINTS, DISABLED_AUTH_PATHS } from "../src/auth/endpoints.ts";

/**
 * The endpoint inventory (docs/design/account-self-service.md D27, plan
 * 0.8.0 Y6).
 *
 * Better Auth's route table is the truth: the router serves every endpoint
 * with a path that is not marked server only, for each of its methods
 * (`better-call`'s `createRouter`). The instance is built with an OIDC and a
 * SAML provider, so every plugin `createAuth` can mount is mounted. Nothing
 * here touches the database: building an instance reads nothing.
 */

const pool = new Pool({ max: 1 });

afterAll(async () => {
  await pool.end();
});

const everyPlugin = (plugins: BetterAuthPlugin[] = []) =>
  createAuth({
    pool,
    secret: "a-test-secret-of-sufficient-length-for-signing",
    baseUrl: "http://localhost:3000",
    rateLimit: { enabled: false },
    ssoProviders: [
      {
        providerId: "sso-oidc",
        clientId: "client",
        clientSecret: "secret",
        authorizationUrl: "http://127.0.0.1:9/authorize",
        tokenUrl: "http://127.0.0.1:9/token",
      },
      {
        kind: "saml",
        providerId: "sso-saml",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        clientId: "",
        clientSecret: "",
      },
    ],
    plugins,
  });

interface Served {
  readonly path: string;
  readonly methods: readonly string[];
}

/** What the router serves, read the way `better-call` reads it. */
const servedRoutes = (api: object): Served[] =>
  Object.values(api as Record<string, unknown>).flatMap((endpoint) => {
    const { path, options } = endpoint as {
      path?: string;
      options?: {
        method?: string | string[];
        metadata?: { SERVER_ONLY?: boolean };
      };
    };
    if (!path || !options || options.metadata?.SERVER_ONLY) {
      return [];
    }
    const methods = Array.isArray(options.method)
      ? options.method
      : [options.method ?? ""];
    return [{ path, methods: [...methods].sort() }];
  });

/** Every way the inventory and the route table disagree, by path. */
const drift = (served: readonly Served[]) => {
  const listed = new Map(AUTH_ENDPOINTS.map((entry) => [entry.path, entry]));
  const servedPaths = new Map(served.map((route) => [route.path, route]));
  return {
    unclassified: served
      .filter((route) => !listed.has(route.path))
      .map((route) => route.path),
    listedInVain: AUTH_ENDPOINTS.filter(
      (entry) => !servedPaths.has(entry.path),
    ).map((entry) => entry.path),
    methodsMoved: served
      .filter((route) => {
        const entry = listed.get(route.path);
        return (
          entry !== undefined &&
          [...entry.methods].sort().join() !== route.methods.join()
        );
      })
      .map((route) => route.path),
  };
};

describe("the endpoint inventory", () => {
  it("classifies every path the catch-all serves, and lists nothing it does not", () => {
    expect(drift(servedRoutes(everyPlugin().api))).toEqual({
      unclassified: [],
      listedInVain: [],
      methodsMoved: [],
    });
  });

  it("fails naming an endpoint a plugin adds", () => {
    const fake: BetterAuthPlugin = {
      id: "fake",
      endpoints: {
        fakeThing: createAuthEndpoint(
          "/fake/thing",
          { method: "POST" },
          async (context) => context.json({ ok: true }),
        ),
      },
    };

    expect(drift(servedRoutes(everyPlugin([fake]).api)).unclassified).toEqual([
      "/fake/thing",
    ]);
  });

  it("leaves out what the router never serves", () => {
    const api = everyPlugin().api as unknown as Record<
      string,
      { path?: string; options?: { metadata?: { SERVER_ONLY?: boolean } } }
    >;
    // Set a password, the one-time code and the backup codes for viewing
    // are server only; a later change calls the first from a server action.
    for (const key of ["setPassword", "generateTOTP", "viewBackupCodes"]) {
      expect(api[key]?.options?.metadata?.SERVER_ONLY).toBe(true);
    }
    const paths = servedRoutes(api).map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(AUTH_ENDPOINTS.length);
  });

  it("hands Better Auth every path marked off, and only those", () => {
    const auth = everyPlugin();
    const expected = AUTH_ENDPOINTS.filter((entry) => entry.served === "off")
      .map((entry) => entry.path)
      .sort();

    expect([...(auth.options.disabledPaths ?? [])].sort()).toEqual(expected);
    expect([...DISABLED_AUTH_PATHS].sort()).toEqual(expected);
  });

  it("marks off only paths `disabledPaths` can name", () => {
    // It compares the exact path, so `/x/:id` would never match a request
    // and the entry would read as off while answering (D28).
    const parameterised = AUTH_ENDPOINTS.filter(
      (entry) => entry.served === "off" && entry.path.includes(":"),
    );
    expect(parameterised).toEqual([]);
  });

  it("gives every entry a reason", () => {
    for (const entry of AUTH_ENDPOINTS) {
      expect(entry.why.trim(), entry.path).not.toBe("");
    }
  });

  it("keeps the endpoints the design names off, off", () => {
    // The ones the plan row was written for, pinned by name so a later edit
    // to the list cannot quietly turn one back on.
    for (const path of [
      "/update-user",
      "/change-email",
      "/verify-password",
      "/get-access-token",
      "/refresh-token",
      "/revoke-sessions",
      "/unlink-account",
      "/sso/register",
    ]) {
      expect(DISABLED_AUTH_PATHS, path).toContain(path);
    }
  });
});
