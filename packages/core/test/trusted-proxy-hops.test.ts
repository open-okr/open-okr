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

/**
 * The address limiter counts the caller the hop setting names
 * (docs/design/sign-in-rate-limit.md). The unit rules are in
 * `caller-address.test.ts`; this proves Better Auth's own limiter sees them,
 * which it can only do through the handler.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";

const build = async () =>
  createAuth({
    pool: (await workerDb()).appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    // The hold would refuse before the limiter counted the eleventh.
    lockout: { enabled: false },
  });

const signIn = (
  auth: Awaited<ReturnType<typeof build>>,
  headers: Record<string, string>,
  attempt: number,
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        email: "someone@example.com",
        password: `wrong-${attempt}`,
      }),
    }),
  );

beforeEach(async () => {
  await (await workerDb()).truncateAllTables();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await (await workerDb()).close();
});

describe("the address limiter behind one proxy", () => {
  it("limits each rightmost address on its own, whatever the caller wrote to its left", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXY_HOPS", "1");
    const auth = await build();
    for (let attempt = 0; attempt < 10; attempt++) {
      // A new leftmost entry every time must not buy a fresh window.
      const response = await signIn(
        auth,
        { "x-forwarded-for": `10.0.0.${attempt + 1}, 198.51.100.4` },
        attempt,
      );
      expect(response.status).toBe(401);
    }
    const refused = await signIn(
      auth,
      { "x-forwarded-for": "10.9.9.9, 198.51.100.4" },
      10,
    );
    expect(refused.status).toBe(429);

    const other = await signIn(
      auth,
      { "x-forwarded-for": "10.9.9.9, 198.51.100.5" },
      11,
    );
    expect(other.status).toBe(401);
  });

  it("ignores a private header the caller sent", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXY_HOPS", "1");
    const auth = await build();
    for (let attempt = 0; attempt < 10; attempt++) {
      await signIn(
        auth,
        {
          "x-forwarded-for": "198.51.100.6",
          "x-openokr-caller": `192.0.2.${attempt + 1}`,
        },
        attempt,
      );
    }
    const refused = await signIn(
      auth,
      { "x-forwarded-for": "198.51.100.6", "x-openokr-caller": "192.0.2.200" },
      10,
    );
    expect(refused.status).toBe(429);
  });
});

describe("the address limiter behind two proxies", () => {
  it("counts the second entry from the right", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXY_HOPS", "2");
    const auth = await build();
    for (let attempt = 0; attempt < 10; attempt++) {
      // The proxy address on the right changes; the caller does not.
      await signIn(
        auth,
        { "x-forwarded-for": `203.0.113.9, 198.51.100.${attempt + 1}` },
        attempt,
      );
    }
    const refused = await signIn(
      auth,
      { "x-forwarded-for": "203.0.113.9, 198.51.100.99" },
      10,
    );
    expect(refused.status).toBe(429);
  });
});
