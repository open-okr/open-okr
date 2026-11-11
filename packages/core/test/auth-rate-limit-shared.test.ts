import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { authLimiterStorage } from "../src/auth/limiter-storage.ts";

/**
 * The address limiter's count, shared by every process
 * (docs/design/account-lockout.md D10, plan 0.7.0 P10b).
 *
 * Better Auth keeps the count in a `Map` in each process unless it is handed
 * a storage, so two replicas allowed twice the limit. `createAuth` now takes
 * one, and the web app hands it the Postgres cache. That the cache's count is
 * shared across connections is proved where the cache is
 * (`packages/adapters/test/drivers.test.ts`); this proves both instances
 * count against whatever storage they are given, with the same keys and
 * rules, and that a refusal still answers as the limiter's own 429.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";

/** Stands in for the Postgres cache: one count per key, as it keeps them. */
function sharedCache() {
  const counts = new Map<string, number>();
  const calls: { key: string; limit: number; windowSeconds: number }[] = [];
  return {
    calls,
    async rateLimit(key: string, limit: number, windowSeconds: number) {
      calls.push({ key, limit, windowSeconds });
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return {
        allowed: used <= limit,
        remaining: Math.max(0, limit - used),
        resetSeconds: windowSeconds,
      };
    },
  };
}

let cache: ReturnType<typeof sharedCache>;

const build = async () =>
  createAuth({
    pool: (await workerDb()).appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    // The hold would refuse the sixth wrong password before the limiter
    // counted the eleventh; this is about the limiter alone.
    lockout: { enabled: false },
    rateLimitStorage: authLimiterStorage(cache),
  });

const signIn = (
  auth: Awaited<ReturnType<typeof build>>,
  address: string,
  attempt: number,
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": address,
      },
      body: JSON.stringify({
        email: "someone@example.com",
        password: `wrong-${attempt}`,
      }),
    }),
  );

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  cache = sharedCache();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the address limiter across processes", () => {
  it("counts one address's sign-ins on two instances as one", async () => {
    const first = await build();
    const second = await build();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await signIn(first, "203.0.113.90", attempt)).status);
    }
    for (let attempt = 6; attempt < 10; attempt++) {
      statuses.push((await signIn(second, "203.0.113.90", attempt)).status);
    }
    expect(statuses.every((status) => status === 401)).toBe(true);

    const eleventh = await signIn(second, "203.0.113.90", 10);
    expect(eleventh.status).toBe(429);
    // The limiter's own answer, which the route wrapper audits.
    expect(Number(eleventh.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });

  it("asks with the sign-in rule and a key naming the address and the path", async () => {
    await signIn(await build(), "203.0.113.91", 0);
    const call = cache.calls.at(-1);
    expect(call?.key.startsWith("auth:")).toBe(true);
    expect(call?.key).toContain("203.0.113.91");
    expect(call?.key).toContain("/sign-in/email");
    expect(call?.limit).toBe(10);
    expect(call?.windowSeconds).toBe(60);
  });

  it("asks the reset request rule for five a minute", async () => {
    const auth = await build();
    await auth.handler(
      new Request(`${BASE_URL}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.92",
        },
        body: JSON.stringify({
          email: "someone@example.com",
          redirectTo: `${BASE_URL}/reset-password`,
        }),
      }),
    );
    const call = cache.calls.find((entry) =>
      entry.key.includes("/request-password-reset"),
    );
    expect(call).toMatchObject({ limit: 5, windowSeconds: 60 });
  });

  it("counts password changes from one network on two instances as one, ten a minute", async () => {
    // account-self-service.md D11: it used to fall under the catch-all, a
    // hundred a minute counted in each process.
    const first = await build();
    const second = await build();
    const change = (auth: Awaited<ReturnType<typeof build>>) =>
      auth.handler(
        new Request(`${BASE_URL}/api/auth/change-password`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.93",
          },
          body: JSON.stringify({
            currentPassword: "not signed in",
            newPassword: "not signed in either",
          }),
        }),
      );
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await change(first)).status);
      statuses.push((await change(second)).status);
    }
    // No session, so each reaches the endpoint and is refused there.
    expect(statuses.every((status) => status === 401)).toBe(true);

    const eleventh = await change(first);
    expect(eleventh.status).toBe(429);
    expect(Number(eleventh.headers.get("x-retry-after"))).toBeGreaterThan(0);
    const call = cache.calls.find((entry) =>
      entry.key.includes("/change-password"),
    );
    expect(call).toMatchObject({ limit: 10, windowSeconds: 60 });
  });
});

describe("what is shared and what stays in the process", () => {
  it("keeps a path with no rule of its own in the process, so a session check costs the database nothing", async () => {
    const auth = await build();
    for (let check = 0; check < 3; check++) {
      await auth.handler(
        new Request(`${BASE_URL}/api/auth/get-session`, {
          headers: { "x-forwarded-for": "203.0.113.93" },
        }),
      );
    }
    expect(
      cache.calls.filter((call) => call.key.includes("/get-session")),
    ).toEqual([]);
  });

  it("still limits that path in the process, at a hundred a minute", async () => {
    const auth = await build();
    const statuses: number[] = [];
    for (let check = 0; check < 101; check++) {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/get-session`, {
          headers: { "x-forwarded-for": "203.0.113.94" },
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 100).every((status) => status === 200)).toBe(true);
    expect(statuses[100]).toBe(429);
  });
});

describe("the storage's answer", () => {
  it("allows with no wait, and refuses with the seconds the window has left", async () => {
    const storage = authLimiterStorage({
      rateLimit: async (_key, limit) => ({
        allowed: limit > 1,
        remaining: 0,
        resetSeconds: 17,
      }),
    });
    expect(await storage.consume("k", { window: 60, max: 2 })).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await storage.consume("k", { window: 60, max: 1 })).toEqual({
      allowed: false,
      retryAfter: 17,
    });
  });

  it("never asks a refused caller to wait zero seconds", async () => {
    const storage = authLimiterStorage({
      rateLimit: async () => ({
        allowed: false,
        remaining: 0,
        resetSeconds: 0,
      }),
    });
    expect(await storage.consume("k", { window: 60, max: 1 })).toEqual({
      allowed: false,
      retryAfter: 1,
    });
  });
});

/**
 * Two people behind one CDN edge (docs/design/trusted-proxies.md, plan 0.8.0
 * H2). With nothing set, a chain places nobody, so both share one count; with
 * the edge's range named, each is counted as themselves.
 */
describe("two callers behind one edge", () => {
  const EDGE = "172.70.1.2";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const tenFrom = async (
    auth: Awaited<ReturnType<typeof build>>,
    chain: string,
  ) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await signIn(auth, chain, attempt)).status).toBe(401);
    }
    expect((await signIn(auth, chain, 10)).status).toBe(429);
  };

  it("share one count when nothing names the edge", async () => {
    const auth = await build();
    await tenFrom(auth, `198.51.100.7, ${EDGE}`);
    expect((await signIn(auth, `198.51.100.8, ${EDGE}`, 0)).status).toBe(429);
  });

  it("get a count each when the edge's range is trusted", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXIES", "172.64.0.0/13");
    const auth = await build();
    await tenFrom(auth, `198.51.100.7, ${EDGE}`);
    expect((await signIn(auth, `198.51.100.8, ${EDGE}`, 0)).status).toBe(401);
  });
});
