import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The web process seals identity-provider tokens under the instance's own key
 * ring (completeness review L-11).
 *
 * `createAuth` falls back to a ring made for one process when it is given
 * none, which never stores a token as issued but loses every one at the next
 * restart, and which `pnpm keys:rotate` cannot reach. The web process is the
 * one that signs people in through a provider, so it is the one that must
 * pass the real ring. Mocked, because what is under test is the wiring, and
 * `packages/core/test/account-token-sealing.test.ts` covers the sealing
 * against a real database.
 */

const createAuthMock = vi.fn((_options: unknown) => ({ handler: vi.fn() }));
const getKeyRingMock = vi.fn();

vi.mock("@openokr/core", () => ({
  createAuth: createAuthMock,
  resolveRequireEmailVerification: vi.fn(),
}));
vi.mock("@openokr/config", () => ({
  loadEnv: () => ({
    BETTER_AUTH_SECRET: "a-test-secret-of-sufficient-length-for-signing",
    BETTER_AUTH_URL: "http://localhost:3000",
  }),
}));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("../lib/instance-name", () => ({ getInstanceName: vi.fn() }));
vi.mock("../lib/pool", () => ({ getPool: () => "fake-pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: getKeyRingMock }));
vi.mock("../lib/sso", () => ({ getSSOProviders: () => [] }));

afterEach(() => {
  delete (globalThis as { openokrAuth?: unknown }).openokrAuth;
  vi.resetModules();
});

describe("the web process's auth instance", () => {
  it("seals provider tokens under the instance's key ring", async () => {
    const { getAuth } = await import("../lib/auth");
    getAuth();

    const options = createAuthMock.mock.calls[0]?.[0] as {
      keyRing?: unknown;
    };
    expect(options.keyRing).toBe(getKeyRingMock);
  });

  it("does not read the ring while building the instance", async () => {
    // A build worker has no key, and a password sign-in needs none.
    const { getAuth } = await import("../lib/auth");
    getAuth();
    expect(getKeyRingMock).not.toHaveBeenCalled();
  });
});
