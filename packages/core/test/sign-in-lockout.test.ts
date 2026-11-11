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
import { purgeStaleSignInAttempts } from "../src/auth/lockout.ts";

/**
 * Holding password sign-in after too many failures
 * (docs/design/account-lockout.md §4, plan 0.7.0 P10).
 *
 * Driven through Better Auth's HTTP handler, the surface a browser reaches.
 * The address limiter is off so that what refuses an attempt here is the hold
 * and nothing else; `auth.test.ts` covers the limiter.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const EMAIL = "someone@example.com";
const PASSWORD = "correct horse battery staple";

let auth: Auth;
let heldNotices: { to: string; resetUrl: string }[];
let resetLinks: string[];

const build = (pool: Awaited<ReturnType<typeof workerDb>>["appPool"]) =>
  createAuth({
    pool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
    sendResetPassword: async ({ url }) => {
      resetLinks.push(url);
    },
    sendSignInHeldNotice: async (message) => {
      heldNotices.push(message);
    },
  });

const post = (
  instance: Auth,
  path: string,
  body: unknown,
  address = "203.0.113.1",
) =>
  instance.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": address,
      },
      body: JSON.stringify(body),
    }),
  );

const attempt = (
  address: string,
  password: string,
  email = EMAIL,
  instance = auth,
) => post(instance, "/sign-in/email", { email, password }, address);

const wrong = async (address: string, times: number, email = EMAIL) => {
  const statuses: number[] = [];
  for (let index = 0; index < times; index++) {
    statuses.push((await attempt(address, `wrong-${index}`, email)).status);
  }
  return statuses;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  heldNotices = [];
  resetLinks = [];
  auth = build(wb.appPool);
  const signUp = await post(
    auth,
    "/sign-up/email",
    { email: EMAIL, password: PASSWORD, name: "Someone" },
    "192.0.2.200",
  );
  expect(signUp.status).toBe(200);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the pair hold", () => {
  it("refuses the sixth attempt from one address without checking the password", async () => {
    expect(await wrong("203.0.113.1", 5)).toEqual([401, 401, 401, 401, 401]);

    // The right password, refused: so it was never checked.
    const held = await attempt("203.0.113.1", PASSWORD);
    expect(held.status).toBe(429);
    const retryAfter = Number(held.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await held.json()) as Record<string, unknown>;
    expect(body.code).toBe("SIGN_IN_HELD");
    expect(body.retryAfterSeconds).toBe(retryAfter);
    expect(body.message).toMatch(/try again in 1 minute/i);
    expect(body.message).toMatch(/reset your password/i);
  });

  it("does not hold the same account from another address", async () => {
    await wrong("203.0.113.2", 5);
    expect((await attempt("198.51.100.2", PASSWORD)).status).toBe(200);
  });

  it("answers an address with no account exactly as it answers one with an account", async () => {
    await wrong("203.0.113.3", 5);
    await wrong("203.0.113.4", 5, "nobody@example.com");

    const real = await attempt("203.0.113.3", "wrong-again");
    const unknown = await attempt(
      "203.0.113.4",
      "wrong-again",
      "nobody@example.com",
    );
    expect(real.status).toBe(429);
    expect(unknown.status).toBe(real.status);
    // The seconds left can differ by one, because the two holds began a few
    // milliseconds apart; everything else must be identical.
    const { retryAfterSeconds: _real, ...realBody } =
      (await real.json()) as Record<string, unknown>;
    const { retryAfterSeconds: _unknown, ...unknownBody } =
      (await unknown.json()) as Record<string, unknown>;
    expect(unknownBody).toEqual(realBody);
  });

  it("forgets a run of failures after a right password", async () => {
    await wrong("203.0.113.5", 4);
    expect((await attempt("203.0.113.5", PASSWORD)).status).toBe(200);
    expect(await wrong("203.0.113.5", 5)).toEqual([401, 401, 401, 401, 401]);
  });

  it("lets at most five of fifty parallel guesses reach the password check", async () => {
    const statuses = await Promise.all(
      Array.from(
        { length: 50 },
        async (_, index) =>
          (await attempt("203.0.113.6", `guess-${index}`)).status,
      ),
    );
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(45);
  });

  it("is shared by two application processes on one database", async () => {
    const other = build((await workerDb()).appPool);
    for (let index = 0; index < 3; index++) {
      await attempt("203.0.113.7", `a-${index}`);
    }
    for (let index = 0; index < 2; index++) {
      await attempt("203.0.113.7", `b-${index}`, EMAIL, other);
    }
    expect((await attempt("203.0.113.7", "c", EMAIL, other)).status).toBe(429);
  });
});

describe("the account hold", () => {
  const twentyAddresses = async () => {
    for (let index = 0; index < 20; index++) {
      expect((await attempt(`198.18.0.${index + 1}`, "guess")).status).toBe(
        401,
      );
    }
  };

  it("holds a new address after twenty failures from twenty, but never a known one", async () => {
    // Last week's desk: a success stamps the address as known.
    expect((await attempt("192.0.2.10", PASSWORD)).status).toBe(200);

    await twentyAddresses();

    const stranger = await attempt("198.18.1.1", PASSWORD);
    expect(stranger.status).toBe(429);
    expect(((await stranger.json()) as { code: string }).code).toBe(
      "SIGN_IN_HELD",
    );

    expect((await attempt("192.0.2.10", PASSWORD)).status).toBe(200);
  });

  it("writes one audit row and emails the account holder once when it begins", async () => {
    await twentyAddresses();
    await attempt("198.18.1.2", "guess");
    await attempt("198.18.1.3", "guess");

    const wb = await workerDb();
    await vi.waitFor(async () => {
      const rows = await wb.admin.query(
        "select payload from instance_audit_events where action = 'auth.sign_in_held'",
      );
      expect(rows.rows).toHaveLength(1);
    });
    const { rows } = await wb.admin.query(
      "select payload from instance_audit_events where action = 'auth.sign_in_held'",
    );
    const user = await wb.admin.query("select id from users where email = $1", [
      EMAIL,
    ]);
    expect(rows[0].payload).toEqual({
      userId: user.rows[0].id,
      failures: 20,
      holdSeconds: 60,
    });
    const text = JSON.stringify(rows[0].payload);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("198.18");

    await vi.waitFor(() => expect(heldNotices).toHaveLength(1));
    expect(heldNotices[0]).toEqual({
      to: EMAIL,
      resetUrl: `${BASE_URL}/forgot-password`,
    });
  });

  it("writes nothing and sends nothing when the address has no account", async () => {
    for (let index = 0; index < 21; index++) {
      await attempt(`198.18.2.${index + 1}`, "guess", "nobody@example.com");
    }
    // Long enough for a fire-and-forget write to have landed if there were one.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select 1 from instance_audit_events where action = 'auth.sign_in_held'",
    );
    expect(rows.rows).toHaveLength(0);
    expect(heldNotices).toHaveLength(0);
  });
});

describe("what clears a hold", () => {
  it("a completed password reset", async () => {
    await wrong("203.0.113.20", 5);
    expect((await attempt("203.0.113.20", PASSWORD)).status).toBe(429);

    const requested = await post(
      auth,
      "/request-password-reset",
      { email: EMAIL, redirectTo: `${BASE_URL}/reset-password` },
      "192.0.2.50",
    );
    expect(requested.status).toBe(200);
    const link = resetLinks.at(-1) ?? "";
    const token = new URL(link).pathname.split("/").at(-1) ?? "";
    const NEW_PASSWORD = "a brand new and longer password";
    const reset = await post(
      auth,
      "/reset-password",
      { newPassword: NEW_PASSWORD, token },
      "192.0.2.50",
    );
    expect(reset.status).toBe(200);

    expect((await attempt("203.0.113.20", NEW_PASSWORD)).status).toBe(200);
  });

  it("a session made by any factor, which clears the account counter", async () => {
    for (let index = 0; index < 20; index++) {
      await attempt(`198.18.3.${index + 1}`, "guess");
    }
    expect((await attempt("198.18.4.1", PASSWORD)).status).toBe(429);

    // A passkey or single sign-on ends the same way, in a session row; this
    // makes one without a password, as either of them would.
    const wb = await workerDb();
    const user = await wb.admin.query("select id from users where email = $1", [
      EMAIL,
    ]);
    const context = await auth.$context;
    await context.internalAdapter.createSession(user.rows[0].id);

    expect((await attempt("198.18.4.1", PASSWORD)).status).toBe(200);
  });
});

describe("the daily purge", () => {
  it("removes rows nobody touched for thirty days and keeps the rest", async () => {
    await wrong("203.0.113.30", 1);
    const wb = await workerDb();
    await wb.admin.query(
      `insert into sign_in_attempts (account_key, caller_key, failures, updated_at)
       values ('stale', '', 3, now() - interval '31 days')`,
    );
    const before = await wb.admin.query(
      "select count(*)::int as n from sign_in_attempts",
    );

    expect(await purgeStaleSignInAttempts(wb.appPool)).toBe(1);

    const after = await wb.admin.query(
      "select count(*)::int as n from sign_in_attempts",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n - 1);
    const stale = await wb.admin.query(
      "select 1 from sign_in_attempts where account_key = 'stale'",
    );
    expect(stale.rows).toHaveLength(0);
  });
});

/**
 * Every password check behind a session counts toward the same hold
 * (docs/design/account-self-service.md D3, plan 0.8.0 Y3). Before this only
 * `/sign-in/email` was counted, so a stolen session cookie could test
 * passwords freely through the password change, the second-factor endpoints
 * and a server call to verify one.
 */
describe("password checks behind a session", () => {
  const STOLEN = "203.0.113.40";
  const NEW_PASSWORD = "a longer and newer passphrase";
  let cookie: string;

  const behindSession = (path: string, body: unknown, address = STOLEN) =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          cookie,
          "x-forwarded-for": address,
        },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(async () => {
    const signedIn = await attempt("192.0.2.200", PASSWORD);
    expect(signedIn.status).toBe(200);
    cookie = signedIn.headers
      .getSetCookie()
      .map((header) => header.split(";")[0] as string)
      .join("; ");
  });

  const wrongChanges = async (times: number) => {
    for (let index = 0; index < times; index++) {
      const response = await behindSession("/change-password", {
        currentPassword: `wrong-${index}`,
        newPassword: NEW_PASSWORD,
      });
      expect(response.status).toBe(400);
    }
  };

  it("counts a wrong current password at the password change toward the sign-in hold", async () => {
    await wrongChanges(5);
    const held = await attempt(STOLEN, PASSWORD);
    expect(held.status).toBe(429);
    expect(((await held.json()) as { code: string }).code).toBe("SIGN_IN_HELD");
  });

  it("holds the sixth password change unchecked, with the wait", async () => {
    await wrongChanges(5);
    const held = await behindSession("/change-password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(held.status).toBe(429);
    expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await held.json()) as { code: string }).code).toBe("SIGN_IN_HELD");
    // The right password was never checked, so nothing changed.
    expect((await attempt("192.0.2.200", PASSWORD)).status).toBe(200);
  });

  it("counts a wrong password at each second-factor endpoint", async () => {
    for (const path of [
      "/two-factor/enable",
      "/two-factor/enable",
      "/two-factor/disable",
      "/two-factor/generate-backup-codes",
      "/two-factor/enable",
    ]) {
      expect((await behindSession(path, { password: "guess" })).status).toBe(
        400,
      );
    }
    expect((await attempt(STOLEN, PASSWORD)).status).toBe(429);
  });

  it("counts a server call that verifies a password", async () => {
    const headers = new Headers({ cookie, "x-forwarded-for": STOLEN });
    for (let index = 0; index < 5; index++) {
      await expect(
        auth.api.verifyPassword({ headers, body: { password: "guess" } }),
      ).rejects.toMatchObject({ body: { code: "INVALID_PASSWORD" } });
    }
    await expect(
      auth.api.verifyPassword({ headers, body: { password: PASSWORD } }),
    ).rejects.toMatchObject({ body: { code: "SIGN_IN_HELD" } });
  });

  it("does not count a request Better Auth refuses before checking anything", async () => {
    for (let index = 0; index < 6; index++) {
      expect(
        (
          await behindSession("/change-password", {
            currentPassword: `wrong-${index}`,
            newPassword: "too short",
          })
        ).status,
      ).toBe(400);
      expect(
        (await behindSession("/two-factor/enable", { password: "" })).status,
      ).toBe(400);
    }
    expect((await attempt(STOLEN, PASSWORD)).status).toBe(200);
  });

  it("is cleared by a check that succeeds, and not by one that is refused", async () => {
    await wrongChanges(4);
    // Refused unchecked: neither counted nor forgiven.
    await behindSession("/change-password", {
      currentPassword: PASSWORD,
      newPassword: "too short",
    });
    await wrongChanges(1);
    expect((await attempt(STOLEN, PASSWORD)).status).toBe(429);
  });

  it("forgets the run once the right password is given", async () => {
    await wrongChanges(4);
    const right = await behindSession("/change-password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(right.status).toBe(200);
    await wrongChanges(4);
    expect((await attempt(STOLEN, NEW_PASSWORD)).status).toBe(200);
  });

  it("marks no address as known when a password change makes a session", async () => {
    const changed = await behindSession("/change-password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });
    expect(changed.status).toBe(200);
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select 1 from sign_in_attempts where last_success_at is not null",
    );
    // The sign-in in `beforeEach` marked its own address, and nothing else.
    expect(rows).toHaveLength(1);
  });
});

/**
 * Behind a CDN, every visitor arrives from a few edge addresses
 * (docs/design/trusted-proxies.md, plan 0.8.0 H2). Named as trusted proxies,
 * those hops are walked past, so the pair counter is keyed on the person
 * rather than on the edge, and one person's wrong passwords hold nobody else.
 */
describe("behind a trusted edge", () => {
  const EDGE = "172.70.1.2";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps one caller's pair hold from holding another caller behind the same edge", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXIES", "172.64.0.0/13");
    const behind = build((await workerDb()).appPool);
    for (let index = 0; index < 5; index++) {
      await attempt(`198.51.100.7, ${EDGE}`, `wrong-${index}`, EMAIL, behind);
    }
    expect(
      (await attempt(`198.51.100.7, ${EDGE}`, PASSWORD, EMAIL, behind)).status,
    ).toBe(429);

    expect(
      (await attempt(`198.51.100.8, ${EDGE}`, PASSWORD, EMAIL, behind)).status,
    ).toBe(200);
  });

  it("records the caller, not the edge, on the session", async () => {
    vi.stubEnv("OPENOKR_TRUSTED_PROXIES", "172.64.0.0/13");
    const behind = build((await workerDb()).appPool);
    expect(
      (
        await attempt(
          `203.0.113.66, 198.51.100.9, ${EDGE}`,
          PASSWORD,
          EMAIL,
          behind,
        )
      ).status,
    ).toBe(200);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ ip_address: string }>(
      "select ip_address from sessions order by created_at desc limit 1",
    );
    expect(rows[0]?.ip_address).toBe("198.51.100.9");
  });
});
