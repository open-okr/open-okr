import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The web process follows single sign-on without a restart (completeness
 * review L-15).
 *
 * It built one Better Auth instance for its whole life, with the SSO
 * providers it read at boot, so a connection saved on the admin screen
 * reached nobody until a restart. Mocked, because what is under test is the
 * wiring: which instance the authentication route serves, what the instance
 * is built from, and who tells the tracker to look again.
 * `packages/core/test/sso-without-restart.test.ts` drives real sign-ins
 * through the same tracker and follower against a real database and a real
 * identity provider.
 */

const BASE_URL = "http://localhost:3000";

const createAuthMock = vi.fn((options: unknown) => ({ options }));
const createSSOConnectionMock = vi.fn();
const loadSSOConnectionsMock = vi.fn();
const syncAllSamlProvidersMock = vi.fn();

/** What `trackSSOProviders` was given, and the tracker it handed back. */
const tracked = {
  options: undefined as
    | undefined
    | {
        pool: unknown;
        load: () => Promise<unknown>;
        onError?: (error: unknown) => void;
      },
  tracker: {
    providers: vi.fn(() => [] as unknown[]),
    refresh: vi.fn(async () => [] as unknown[]),
    current: vi.fn(async () => [] as unknown[]),
    expire: vi.fn(),
  },
};

/** What `followSSOProviders` was given, and the follower it handed back. */
const followed = {
  tracker: undefined as unknown,
  build: undefined as undefined | ((providers: unknown) => unknown),
  follower: {
    latest: vi.fn(() => "the latest instance"),
    current: vi.fn(async () => "the current instance"),
  },
};

class SSOConnectionRejected extends Error {
  readonly field = "clientId";
}

vi.mock("@openokr/core", () => ({
  ACCESS_LEVELS: { full: "full" },
  createAuth: createAuthMock,
  createSSOConnection: createSSOConnectionMock,
  followSSOProviders: (tracker: unknown, build: (p: unknown) => unknown) => {
    followed.tracker = tracker;
    followed.build = build;
    return followed.follower;
  },
  loadSSOConnections: loadSSOConnectionsMock,
  recordInstanceAuditEvent: vi.fn(),
  resolveRequireEmailVerification: vi.fn(),
  SSOConnectionRejected,
  syncAllSamlProviders: syncAllSamlProvidersMock,
  trackSSOProviders: (options: typeof tracked.options) => {
    tracked.options = options;
    return tracked.tracker;
  },
}));
vi.mock("@openokr/config", () => ({
  loadEnv: () => ({
    BETTER_AUTH_SECRET: "a-test-secret-of-sufficient-length-for-signing",
    BETTER_AUTH_URL: BASE_URL,
  }),
}));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("../lib/instance-name", () => ({ getInstanceName: vi.fn() }));
vi.mock("../lib/pool", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => "the ring" }));
vi.mock("../lib/access", () => ({
  requireAccessLevel: async () => ({ workspaceId: "ws-1" }),
}));

const forget = () => {
  const globals = globalThis as {
    openokrAuthFollower?: unknown;
    openokrSSOTracker?: unknown;
  };
  delete globals.openokrAuthFollower;
  delete globals.openokrSSOTracker;
};

beforeEach(forget);

afterEach(() => {
  forget();
  vi.clearAllMocks();
  vi.resetModules();
  tracked.options = undefined;
  followed.tracker = undefined;
  followed.build = undefined;
});

describe("which instance serves a request", () => {
  it("serves the authentication route the current one", async () => {
    followed.follower.current.mockResolvedValueOnce({
      handler: async () => new Response(null, { status: 204 }),
    } as never);
    const { GET } = await import("../app/api/auth/[...all]/route");

    const response = await GET(new Request(`${BASE_URL}/api/auth/ok`));

    expect(response.status).toBe(204);
    expect(followed.follower.current).toHaveBeenCalledTimes(1);
    expect(followed.follower.latest).not.toHaveBeenCalled();
  });

  it("gives everything else the latest one, which never reads the database", async () => {
    const { getAuth } = await import("../lib/auth");

    expect(getAuth()).toBe("the latest instance");
    expect(followed.follower.current).not.toHaveBeenCalled();
    expect(tracked.tracker.current).not.toHaveBeenCalled();
  });
});

describe("what an instance is built from", () => {
  it("follows the process's one tracker", async () => {
    const { getAuth } = await import("../lib/auth");
    const { ssoProviderTracker } = await import("../lib/sso");
    getAuth();

    expect(followed.tracker).toBe(ssoProviderTracker());
  });

  it("hands the providers it is given to Better Auth", async () => {
    const { getAuth } = await import("../lib/auth");
    getAuth();
    const providers = [{ providerId: "sso-acme-12345678" }];

    followed.build?.(providers);

    const options = createAuthMock.mock.calls[0]?.[0] as {
      ssoProviders?: unknown;
      baseUrl?: string;
    };
    expect(options.ssoProviders).toBe(providers);
    expect(options.baseUrl).toBe(BASE_URL);
  });
});

describe("the tracker", () => {
  it("reads the connections and brings the SAML plugin's rows into line", async () => {
    const providers = [{ providerId: "sso-acme-12345678" }];
    loadSSOConnectionsMock.mockResolvedValueOnce(providers);
    syncAllSamlProvidersMock.mockResolvedValueOnce(0);
    const { ssoProviderTracker } = await import("../lib/sso");
    ssoProviderTracker();

    const loaded = await tracked.options?.load();

    expect(tracked.options?.pool).toBe("the pool");
    expect(loadSSOConnectionsMock).toHaveBeenCalledWith("the pool", "the ring");
    expect(syncAllSamlProvidersMock).toHaveBeenCalledWith(
      "the pool",
      providers,
      BASE_URL,
    );
    expect(loaded).toBe(providers);
  });

  it("is read at boot, and a boot that cannot read it still serves", async () => {
    tracked.tracker.refresh.mockRejectedValueOnce(new Error("no database"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { resolveSSOProviders } = await import("../lib/sso");

    await expect(resolveSSOProviders()).resolves.toBeUndefined();

    expect(tracked.tracker.refresh).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls.join()).toContain("no database");
    stderr.mockRestore();
  });
});

describe("saving a connection", () => {
  const save = async () => {
    const { POST } = await import("../app/api/v1/admin/sso/route");
    return POST(
      new Request(`${BASE_URL}/api/v1/admin/sso`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "acme",
          displayName: "Sign in with Acme",
          clientId: "client-one",
          clientSecret: "secret",
          discoveryUrl: "https://idp.example/.well-known/openid-configuration",
        }),
      }),
    );
  };

  it("has this process look again at its next sign-in", async () => {
    createSSOConnectionMock.mockResolvedValueOnce({
      id: "row-1",
      providerId: "sso-acme-ws-1",
    });

    const response = await save();

    expect(response.status).toBe(201);
    expect(tracked.tracker.expire).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when the connection is refused", async () => {
    createSSOConnectionMock.mockRejectedValueOnce(
      new SSOConnectionRejected("no"),
    );

    const response = await save();

    expect(response.status).toBe(400);
    expect(tracked.tracker.expire).not.toHaveBeenCalled();
  });
});
