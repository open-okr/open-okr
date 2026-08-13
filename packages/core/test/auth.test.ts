import { createHash, createHmac } from "node:crypto";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { getCurrentSession, listUserSessions } from "../src/auth/session.ts";

/**
 * Authentication end to end against a real database (P1-T05 test plan):
 * register, log in, bad password, log out; the second-factor challenge; and
 * the property that a raw read of the session table yields only hashes.
 *
 * These drive Better Auth through its HTTP handler rather than its internals,
 * because that is the surface the browser actually reaches.
 */

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;

const BASE_URL = "http://localhost:3000";
const EMAIL = "someone@example.com";
const PASSWORD = "correct horse battery staple";

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

const get = (path: string, headers: Record<string, string> = {}) =>
  auth.handler(new Request(`${BASE_URL}/api/auth${path}`, { headers }));

/**
 * Every cookie a response sets, ready to send back. All of them, not just
 * the session: a second-factor challenge answers with a short-lived cookie
 * of its own, and dropping it makes the challenge unanswerable.
 */
const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .join("; ");

const register = async () => {
  const response = await post("/sign-up/email", {
    email: EMAIL,
    password: PASSWORD,
    name: "Someone",
  });
  return response;
};

const SECRET = "a-test-secret-of-sufficient-length-for-signing";

/**
 * A real TOTP code (RFC 6238) from the shared secret, so the one-time
 * password path is genuinely exercised rather than stubbed. Better Auth only
 * treats a second factor as active once a generated code has been verified.
 */
const totpCode = (base32Secret: string, atMs = Date.now()): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index === -1) {
      continue;
    }
    bits += index.toString(2).padStart(5, "0");
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

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  // Rate limiting is on by default and has its own tests below. It is off
  // here so these cases do not exhaust each other's budget: Better Auth's
  // in-memory limiter is shared across instances in one process.
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("registration and sign in", () => {
  it("registers a user and establishes a session", async () => {
    const response = await register();
    expect(response.status).toBe(200);

    const wb = await workerDb();
    const users = await wb.admin.query("select email, name from users");
    expect(users.rows).toEqual([{ email: EMAIL, name: "Someone" }]);
  });

  it("signs in with the right password", async () => {
    await register();
    const response = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(cookieFrom(response)).toMatch(/session_token=/);
  });

  it("refuses the wrong password without revealing which part was wrong", async () => {
    await register();
    const response = await post("/sign-in/email", {
      email: EMAIL,
      password: "not the password",
    });
    expect(response.status).toBe(401);

    const body = await response.text();
    expect(body).not.toMatch(/password is wrong|no such user/i);
  });

  it("refuses an unknown email address the same way", async () => {
    await register();
    const response = await post("/sign-in/email", {
      email: "nobody@example.com",
      password: PASSWORD,
    });
    expect(response.status).toBe(401);
  });

  it("never stores the password in clear text", async () => {
    await register();
    const wb = await workerDb();
    const accounts = await wb.admin.query("select password from accounts");
    const stored = accounts.rows[0]?.password as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(PASSWORD);
  });

  it("reads back the signed-in user from the session cookie", async () => {
    await register();
    const signIn = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const session = await get("/get-session", { cookie: cookieFrom(signIn) });

    expect(session.status).toBe(200);
    const body = (await session.json()) as { user: { email: string } } | null;
    expect(body?.user.email).toBe(EMAIL);
  });

  it("returns no session without a cookie", async () => {
    await register();
    const session = await get("/get-session");
    const body = await session.json();
    expect(body).toBeNull();
  });

  it("signs out, and the session stops working", async () => {
    // Registering already signs the user in, so this is the only session.
    const cookie = cookieFrom(await register());

    const signOut = await post("/sign-out", {}, { cookie });
    expect(signOut.status).toBe(200);

    const wb = await workerDb();
    const sessions = await wb.admin.query(
      "select count(*)::int as n from sessions",
    );
    expect(sessions.rows[0].n).toBe(0);

    const after = await get("/get-session", { cookie });
    expect(await after.json()).toBeNull();
  });

  it("signing out ends one session, not every session the user has", async () => {
    const firstDevice = cookieFrom(await register());
    const secondDevice = cookieFrom(
      await post("/sign-in/email", { email: EMAIL, password: PASSWORD }),
    );

    await post("/sign-out", {}, { cookie: secondDevice });

    const stillIn = await get("/get-session", { cookie: firstDevice });
    const body = (await stillIn.json()) as { user: { email: string } } | null;
    expect(body?.user.email).toBe(EMAIL);
  });
});

describe("listing and revoking sessions (P2-T09)", () => {
  /**
   * Puts every stored session outside Better Auth's freshness window, which
   * is one day by default while these sessions live for thirty (`createAuth`).
   * Signing in a moment ago is the only state the rest of this file exercises,
   * so without this the freshness rules below never fire.
   */
  const ageEverySession = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update sessions set created_at = now() - interval '2 days'",
    );
  };

  const currentSessionFor = async (cookie: string) => {
    const session = await getCurrentSession(auth, new Headers({ cookie }));
    expect(session).not.toBeNull();
    return session as NonNullable<typeof session>;
  };

  it("lists every active session for the signed-in user", async () => {
    const firstDevice = cookieFrom(await register());
    await post("/sign-in/email", { email: EMAIL, password: PASSWORD });

    const listed = await get("/list-sessions", { cookie: firstDevice });
    expect(listed.status).toBe(200);
    const sessions = (await listed.json()) as Array<{ token: string }>;
    expect(sessions.length).toBe(2);
  });

  it("revokes one session by token, and its next request is rejected", async () => {
    const firstDevice = cookieFrom(await register());
    const secondDevice = cookieFrom(
      await post("/sign-in/email", { email: EMAIL, password: PASSWORD }),
    );

    const listed = await get("/list-sessions", { cookie: firstDevice });
    const sessions = (await listed.json()) as Array<{
      token: string;
      // Better Auth's own field name for which device issued a request last.
      userAgent?: string;
    }>;
    expect(sessions).toHaveLength(2);

    // Revoke the session behind `secondDevice`'s cookie by asking for it by
    // token, from the *other* device — this is what an admin's "revoke this
    // device" action does, not a self-revoke.
    const secondSession = await get("/get-session", { cookie: secondDevice });
    const secondBody = (await secondSession.json()) as {
      session: { token: string };
    };

    const revoke = await post(
      "/revoke-session",
      { token: secondBody.session.token },
      { cookie: firstDevice },
    );
    expect(revoke.status).toBe(200);

    const after = await get("/get-session", { cookie: secondDevice });
    expect(await after.json()).toBeNull();

    // The other device is unaffected.
    const stillIn = await get("/get-session", { cookie: firstDevice });
    const stillInBody = (await stillIn.json()) as {
      user: { email: string };
    } | null;
    expect(stillInBody?.user.email).toBe(EMAIL);
  });

  /**
   * The freshness rule, pinned as the reason the security page cannot read
   * its list through the endpoint. Better Auth gates `/list-sessions` on a
   * session having been created within `freshAge` (one day), so a month-long
   * session answers 403 for its remaining twenty-nine days. Raising
   * `freshAge` is not the answer: the same setting decides whether deleting
   * an account still demands the password.
   */
  it("refuses the /list-sessions endpoint once the session is no longer fresh", async () => {
    const cookie = cookieFrom(await register());
    await ageEverySession();

    const listed = await get("/list-sessions", { cookie });
    expect(listed.status).toBe(403);
  });

  it("lists sessions for a signed-in user whose session is no longer fresh", async () => {
    const firstDevice = cookieFrom(await register());
    await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    await ageEverySession();

    const current = await currentSessionFor(firstDevice);
    const sessions = await listUserSessions(auth, current.user.id);

    expect(sessions).toHaveLength(2);
    // What the list is for: naming a device and saying when it signed in.
    for (const session of sessions) {
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeInstanceOf(Date);
    }
    // Newest first, so the most recent sign-in is not buried.
    expect(sessions[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
      sessions[1]?.createdAt.getTime() as number,
    );
  });

  it("revokes a listed session while no session is fresh", async () => {
    const firstDevice = cookieFrom(await register());
    const secondDevice = cookieFrom(
      await post("/sign-in/email", { email: EMAIL, password: PASSWORD }),
    );
    await ageEverySession();

    // Exactly what the security page does: list, then post back the token of
    // a row the user picked.
    const current = await currentSessionFor(firstDevice);
    const sessions = await listUserSessions(auth, current.user.id);
    const other = sessions.find((session) => session.id !== current.session.id);
    expect(other).toBeDefined();

    const revoke = await post(
      "/revoke-session",
      { token: other?.token },
      { cookie: firstDevice },
    );
    expect(revoke.status).toBe(200);

    expect(
      await (await get("/get-session", { cookie: secondDevice })).json(),
    ).toBeNull();
    const stillIn = (await (
      await get("/get-session", { cookie: firstDevice })
    ).json()) as { user: { email: string } } | null;
    expect(stillIn?.user.email).toBe(EMAIL);
  });

  it("leaves another user's sessions alone", async () => {
    const mine = cookieFrom(await register());
    await post("/sign-up/email", {
      email: "someone-else@example.com",
      password: PASSWORD,
      name: "Someone Else",
    });
    await ageEverySession();

    const current = await currentSessionFor(mine);
    const sessions = await listUserSessions(auth, current.user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(current.session.id);
  });
});

describe("session tokens at rest", () => {
  it("stores only hashes: a database copy cannot be replayed", async () => {
    // Two sessions, from registering and then signing in again.
    await register();
    const signIn = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });

    // The token the browser holds.
    const rawToken = decodeURIComponent(
      /better-auth\.session_token=([^;]+)/.exec(cookieFrom(signIn))?.[1] ?? "",
    ).split(".")[0] as string;
    expect(rawToken).toMatch(/^[a-zA-Z0-9]{32}$/);

    const wb = await workerDb();
    const stored = await wb.admin.query("select token from sessions");
    expect(stored.rows).toHaveLength(2);
    const storedTokens = stored.rows.map((row) => row.token as string);

    // Every stored token is a SHA-256 digest, the browser's token hashes to
    // one of them, and the raw value appears nowhere in the table.
    for (const token of storedTokens) {
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(storedTokens).toContain(
      createHash("sha256").update(rawToken).digest("hex"),
    );
    expect(storedTokens).not.toContain(rawToken);
  });

  it("still resolves the session, so hashing is symmetric", async () => {
    await register();
    const signIn = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const session = await get("/get-session", { cookie: cookieFrom(signIn) });
    const body = (await session.json()) as { user: { email: string } } | null;
    expect(body?.user.email).toBe(EMAIL);
  });

  it("refuses a stolen database row replayed as a cookie", async () => {
    await register();
    await post("/sign-in/email", { email: EMAIL, password: PASSWORD });

    const wb = await workerDb();
    const stored = await wb.admin.query("select token from sessions");
    const hashedToken = stored.rows[0]?.token as string;

    // Someone with a database dump has the hash. Presenting it as a cookie
    // must not sign them in: the hash of the hash matches nothing.
    const forged = await get("/get-session", {
      cookie: `better-auth.session_token=${hashedToken}`,
    });
    expect(await forged.json()).toBeNull();
  });
});

describe("two-factor authentication", () => {
  /**
   * Enrols a second factor and confirms it with a generated code, which is
   * what actually activates it: an unverified secret must not lock anyone
   * out of their own account.
   */
  const enrolAndVerify = async () => {
    const cookie = cookieFrom(await register());
    const enrolment = await post(
      "/two-factor/enable",
      { password: PASSWORD },
      { cookie },
    );
    const { totpURI, backupCodes } = (await enrolment.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const secret = new URL(totpURI).searchParams.get("secret") as string;

    const verified = await post(
      "/two-factor/verify-totp",
      { code: totpCode(secret) },
      { cookie },
    );
    expect(verified.status).toBe(200);

    return { secret, backupCodes, totpURI };
  };

  it("enrols a second factor and stores the secret encrypted", async () => {
    const cookie = cookieFrom(await register());
    const response = await post(
      "/two-factor/enable",
      { password: PASSWORD },
      { cookie },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(body.backupCodes.length).toBeGreaterThan(0);

    const wb = await workerDb();
    const stored = await wb.admin.query(
      "select secret, backup_codes from two_factors",
    );
    expect(stored.rows).toHaveLength(1);
    // The shared secret is encrypted at rest: the plain secret from the URI
    // must not appear in the column, or a database copy is a second factor.
    const secretFromUri = new URL(body.totpURI).searchParams.get("secret");
    expect(secretFromUri).toBeTruthy();
    expect(stored.rows[0]?.secret).not.toBe(secretFromUri);
    expect(stored.rows[0]?.backup_codes).not.toContain(body.backupCodes[0]);
  });

  it("refuses to enrol without the account password", async () => {
    const cookie = cookieFrom(await register());
    const response = await post(
      "/two-factor/enable",
      { password: "not the password" },
      { cookie },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("challenges an enrolled user instead of signing them straight in", async () => {
    await enrolAndVerify();

    const response = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const body = (await response.json()) as { twoFactorRedirect?: boolean };

    // The password alone no longer completes sign-in.
    expect(body.twoFactorRedirect).toBe(true);
    expect(cookieFrom(response)).not.toMatch(/session_token=[^;]/);
  });

  it("completes the challenge with a one-time code", async () => {
    const { secret } = await enrolAndVerify();

    const challenge = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const verified = await post(
      "/two-factor/verify-totp",
      { code: totpCode(secret) },
      { cookie: cookieFrom(challenge) },
    );

    expect(verified.status).toBe(200);
    expect(cookieFrom(verified)).toMatch(/session_token=/);
  });

  it("completes the challenge with a backup code", async () => {
    const { backupCodes } = await enrolAndVerify();

    const challenge = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const verified = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      { cookie: cookieFrom(challenge) },
    );

    expect(verified.status).toBe(200);
    expect(cookieFrom(verified)).toMatch(/session_token=/);
  });

  it("refuses a wrong one-time code", async () => {
    await enrolAndVerify();

    const challenge = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const verified = await post(
      "/two-factor/verify-totp",
      { code: "000000" },
      { cookie: cookieFrom(challenge) },
    );
    expect(verified.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a code from a different secret", async () => {
    await enrolAndVerify();

    const challenge = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const verified = await post(
      "/two-factor/verify-totp",
      { code: totpCode("JBSWY3DPEHPK3PXP") },
      { cookie: cookieFrom(challenge) },
    );
    expect(verified.status).toBeGreaterThanOrEqual(400);
  });
});

describe("passkeys", () => {
  it("offers a registration challenge to a signed-in user", async () => {
    await register();
    const signIn = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });

    const response = await get("/passkey/generate-register-options", {
      cookie: cookieFrom(signIn),
    });
    expect(response.status).toBe(200);

    const options = (await response.json()) as {
      challenge: string;
      rp: { id: string };
      user: { name: string };
    };
    expect(options.challenge).toBeTruthy();
    expect(options.rp.id).toBe("localhost");
    expect(options.user.name).toBe(EMAIL);
  });

  it("offers an authentication challenge without a session", async () => {
    await register();
    const response = await get("/passkey/generate-authenticate-options");
    expect(response.status).toBe(200);
    const options = (await response.json()) as { challenge: string };
    expect(options.challenge).toBeTruthy();
  });

  it("refuses a registration challenge to a stranger", async () => {
    const response = await get("/passkey/generate-register-options");
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a forged attestation", async () => {
    await register();
    const signIn = await post("/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    const cookie = cookieFrom(signIn);
    await get("/passkey/generate-register-options", { cookie });

    const response = await post(
      "/passkey/verify-registration",
      {
        response: {
          id: "made-up",
          rawId: "made-up",
          type: "public-key",
          response: { clientDataJSON: "e30", attestationObject: "e30" },
          clientExtensionResults: {},
        },
      },
      { cookie },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);

    const wb = await workerDb();
    const passkeys = await wb.admin.query(
      "select count(*)::int as n from passkeys",
    );
    expect(passkeys.rows[0].n).toBe(0);
  });
});

describe("brute force protection", () => {
  // These need the limiter on, and distinct caller addresses per case:
  // Better Auth's in-memory limiter is shared across instances in one
  // process, so a reused address would carry state between tests.
  beforeEach(async () => {
    const wb = await workerDb();
    auth = createAuth({ pool: wb.appPool, secret: SECRET, baseUrl: BASE_URL });
  });

  const hammer = async (address: string, attempts: number) => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await post(
        "/sign-in/email",
        { email: EMAIL, password: `wrong-${attempt}` },
        { "x-forwarded-for": address },
      );
      statuses.push(response.status);
    }
    return statuses;
  };

  it("stops answering after repeated failures from one caller", async () => {
    await register();
    const statuses = await hammer("203.0.113.9", 12);

    // Somewhere in that run the answer stops being "wrong password" and
    // becomes "too many requests".
    expect(statuses).toContain(429);
  });

  it("does not lock out a different caller", async () => {
    await register();
    await hammer("203.0.113.10", 12);

    const other = await post(
      "/sign-in/email",
      { email: EMAIL, password: PASSWORD },
      { "x-forwarded-for": "198.51.100.4" },
    );
    expect(other.status).toBe(200);
  });
});
