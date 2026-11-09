import { createHmac } from "node:crypto";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth/auth.ts";

/**
 * The second factor's own lock (docs/design/account-lockout.md D9 and D13,
 * plan 0.7.0 P10b).
 *
 * Better Auth already locks a second factor after ten wrong codes in a row.
 * These prove the options are set here rather than inherited, so an upgrade
 * that changes a default shows in a diff, and that the moment the lock begins
 * is written to the instance audit chain, once.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const EMAIL = "someone@example.com";
const PASSWORD = "correct horse battery staple";

let auth: Auth;

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .join("; ");

/** A real TOTP code (RFC 6238), as `auth.test.ts` makes one. */
const totpCode = (base32Secret: string, atMs = Date.now()): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index !== -1) {
      bits += index.toString(2).padStart(5, "0");
    }
  }
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
};

/** A code that is not the current one, nor either neighbour. */
const wrongCode = (secret: string): string => {
  const near = new Set(
    [-30_000, 0, 30_000].map((shift) => totpCode(secret, Date.now() + shift)),
  );
  let code = 0;
  while (near.has(String(code).padStart(6, "0"))) {
    code++;
  }
  return String(code).padStart(6, "0");
};

const enrol = async (): Promise<string> => {
  const signUp = await post("/sign-up/email", {
    email: EMAIL,
    password: PASSWORD,
    name: "Someone",
  });
  const cookie = cookieFrom(signUp);
  const enrolment = await post(
    "/two-factor/enable",
    { password: PASSWORD },
    { cookie },
  );
  const { totpURI } = (await enrolment.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get("secret") as string;
  const verified = await post(
    "/two-factor/verify-totp",
    { code: totpCode(secret) },
    { cookie },
  );
  expect(verified.status).toBe(200);
  return secret;
};

/** A fresh challenge each time: the lock counts across challenges. */
const tryCode = async (code: string) => {
  const challenge = await post("/sign-in/email", {
    email: EMAIL,
    password: PASSWORD,
  });
  return post(
    "/two-factor/verify-totp",
    { code },
    { cookie: cookieFrom(challenge) },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    // The address limiter allows ten code checks a minute, which is the
    // number this needs to spend.
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the second factor's lock", () => {
  it("is configured here, not inherited from Better Auth's defaults", async () => {
    const context = await auth.$context;
    const plugin = context.getPlugin("two-factor") as {
      options?: { accountLockout?: unknown };
    } | null;
    expect(plugin?.options?.accountLockout).toEqual({
      enabled: true,
      maxFailedAttempts: 10,
      durationSeconds: 900,
    });
  });

  it("locks after ten wrong codes, refuses the right one, and audits the moment once", async () => {
    const secret = await enrol();

    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await tryCode(wrongCode(secret));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).not.toBe(429);
    }

    const locked = await tryCode(totpCode(secret));
    expect(locked.status).toBe(429);

    const wb = await workerDb();
    const user = await wb.admin.query("select id from users where email = $1", [
      EMAIL,
    ]);
    await vi.waitFor(async () => {
      const rows = await wb.admin.query(
        "select payload from instance_audit_events where action = 'auth.second_factor_locked'",
      );
      expect(rows.rows).toEqual([{ payload: { userId: user.rows[0].id } }]);
    });
  });

  it("writes nothing for a wrong code that does not reach the lock", async () => {
    const secret = await enrol();
    await tryCode(wrongCode(secret));
    expect((await tryCode(totpCode(secret))).status).toBe(200);

    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select 1 from instance_audit_events where action = 'auth.second_factor_locked'",
    );
    expect(rows.rows).toHaveLength(0);
  });
});
