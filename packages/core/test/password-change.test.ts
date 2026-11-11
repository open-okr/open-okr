import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  passwordCardFor,
  setOwnPassword,
} from "../src/auth/account-self-service.ts";
import { createAuth } from "../src/auth/auth.ts";
import { PASSWORD_CHANGED_TOPIC } from "../src/auth/password-change.ts";
import { derivedProviderId } from "../src/auth/sso.ts";
import { DEMO_PERSONAS } from "../src/demo/personas.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { encryptSecret, parseKeyRing } from "../src/secrets/key-ring.ts";

/**
 * Changing a password while signed in, and setting one where there is none
 * (docs/design/account-self-service.md §8 Y3, plan 0.8.0 Y3).
 *
 * Driven through Better Auth's HTTP handler, which is what the browser and a
 * direct call both reach, so one set of assertions covers the screen and the
 * call that skips it. The address limiter is off, so what refuses an attempt
 * here is the guard under test; `auth-rate-limit-shared.test.ts` covers the
 * limiter, and `sign-in-lockout.test.ts` the counting.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const EMAIL = "changer@example.com";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a longer and newer passphrase";
const HERE = "203.0.113.10";
const ELSEWHERE = "198.51.100.20";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let auth: Auth;
let resetLinks: string[];
let cookie: string;

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");

const send = (
  method: "GET" | "POST",
  path: string,
  body: unknown = {},
  options: { cookie?: string; address?: string } = {},
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        "x-forwarded-for": options.address ?? HERE,
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    }),
  );

const signUp = async (email: string) => {
  const response = await send("POST", "/sign-up/email", {
    email,
    password: PASSWORD,
    name: email,
  });
  expect(response.status).toBe(200);
  return cookieFrom(response);
};

const signIn = (email: string, password: string, address = ELSEWHERE) =>
  send("POST", "/sign-in/email", { email, password }, { address });

const sessionOf = async (withCookie: string) => {
  const response = await send("GET", "/get-session", undefined, {
    cookie: withCookie,
  });
  return (await response.json()) as {
    user: { id: string; email: string };
    session: { createdAt: string };
  } | null;
};

const change = (
  body: Record<string, unknown>,
  withCookie: string = cookie,
  address = HERE,
) => send("POST", "/change-password", body, { cookie: withCookie, address });

const audited = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: Record<string, unknown> }>(
    "select payload from instance_audit_events where action = 'auth.password_changed' order by seq",
  );
  return rows.map((row) => row.payload);
};

const queued = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: Record<string, unknown> }>(
    "select payload from outbox where topic = $1 order by created_at, id",
    [PASSWORD_CHANGED_TOPIC],
  );
  return rows.map((row) => row.payload);
};

const userIdOf = async (email: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  return rows[0]?.id as string;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  // Open, so a second account can sign up after the first claims the
  // instance; the registration rule is somebody else's subject.
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', '"open"'::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
  );
  resetLinks = [];
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
    sendResetPassword: async ({ url }) => {
      resetLinks.push(url);
    },
  });
  cookie = await signUp(EMAIL);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("changing the password while signed in", () => {
  it("changes it, ends every other session, keeps this browser signed in, and records it once", async () => {
    const other = cookieFrom(await signIn(EMAIL, PASSWORD));
    expect(await sessionOf(other)).not.toBeNull();

    const response = await change({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });
    expect(response.status).toBe(200);

    // This browser has a new session; every other one is gone.
    const fresh = cookieFrom(response);
    expect((await sessionOf(fresh))?.user.email).toBe(EMAIL);
    expect(await sessionOf(other)).toBeNull();

    expect((await signIn(EMAIL, PASSWORD)).status).toBe(401);
    expect((await signIn(EMAIL, NEW_PASSWORD)).status).toBe(200);

    const userId = await userIdOf(EMAIL);
    expect(await audited()).toEqual([
      { userId, via: "change", otherSessionsEnded: true, address: HERE },
    ]);
    const mails = await queued();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      userId,
      to: EMAIL,
      via: "change",
      otherSessionsEnded: true,
    });
    expect(Number.isNaN(Date.parse(String(mails[0]?.at)))).toBe(false);
  });

  it("leaves the other sessions alone when the box is unticked, and says so", async () => {
    const other = cookieFrom(await signIn(EMAIL, PASSWORD));

    const response = await change({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: false,
    });
    expect(response.status).toBe(200);
    expect(await sessionOf(other)).not.toBeNull();
    expect(await sessionOf(cookie)).not.toBeNull();

    expect(await audited()).toEqual([
      expect.objectContaining({ via: "change", otherSessionsEnded: false }),
    ]);
    expect(await queued()).toEqual([
      expect.objectContaining({ otherSessionsEnded: false }),
    ]);
  });

  it("changes nothing and records nothing for a wrong current password", async () => {
    const response = await change({
      currentPassword: "not the password at all",
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "INVALID_PASSWORD",
    );
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
    expect(await audited()).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it("refuses a new password of 11 characters with Better Auth's own code, and counts nothing", async () => {
    for (let index = 0; index < 6; index++) {
      const response = await change({
        currentPassword: `wrong-${index}`,
        newPassword: "elevenchars",
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe(
        "PASSWORD_TOO_SHORT",
      );
    }
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select 1 from sign_in_attempts where failures > 0",
    );
    expect(rows).toEqual([]);
    expect(await audited()).toEqual([]);
  });

  it("answers 401 with no session, and records nothing", async () => {
    const response = await change(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      "",
    );
    expect(response.status).toBe(401);
    expect(await audited()).toEqual([]);
  });
});

describe("a demonstration account", () => {
  const DEMO = DEMO_PERSONAS[0]?.email as string;

  it("is refused with 403 before any session ends, and its card says why", async () => {
    const demoCookie = await signUp(DEMO);
    const other = cookieFrom(await signIn(DEMO, PASSWORD));

    const response = await change(
      {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        revokeOtherSessions: true,
      },
      demoCookie,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "DEMO_ACCOUNT",
      message:
        "Demonstration accounts keep their password. Anyone can sign in to them, so anyone could change it.",
    });
    expect(await sessionOf(other)).not.toBeNull();
    expect((await signIn(DEMO, PASSWORD)).status).toBe(200);
    expect(await audited()).toEqual([]);

    const session = await sessionOf(demoCookie);
    expect(
      await passwordCardFor((await workerDb()).appPool, {
        userId: session?.user.id as string,
        email: DEMO,
        sessionCreatedAt: session?.session.createdAt as string,
      }),
    ).toEqual({ kind: "demo" });
  });

  it("cannot turn a one-time code on, so no visitor can lock the others out (AS-Q8)", async () => {
    const demoCookie = await signUp(DEMO);
    const response = await send(
      "POST",
      "/two-factor/enable",
      { password: PASSWORD },
      { cookie: demoCookie },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "DEMO_ACCOUNT",
      message:
        "Demonstration accounts keep their sign-in as it is. Anyone can sign in to them.",
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select 1 from two_factors where user_id = $1",
      [await userIdOf(DEMO)],
    );
    expect(rows).toEqual([]);
  });

  it("cannot set a password either", async () => {
    const demoCookie = await signUp(DEMO);
    expect(
      await setOwnPassword(auth, (await workerDb()).appPool, {
        headers: new Headers({ cookie: demoCookie }),
        newPassword: NEW_PASSWORD,
      }),
    ).toEqual({ ok: false, reason: "demo" });
  });
});

describe("an account single sign-on claims", () => {
  const ENFORCED = "member@acme.test";

  /** An enforcing connection in the workspace the account's sign-up made. */
  const enforce = async (userId: string) => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ workspace_id: string }>(
      "select workspace_id from workspace_members where user_id = $1",
      [userId],
    );
    const sealed = encryptSecret(ring, "a-client-secret");
    await wb.admin.query(
      `insert into sso_connections
         (workspace_id, provider_id, display_name, client_id,
          secret_ciphertext, secret_data_key, secret_key_id, enforce,
          email_domains)
       values ($1, 'okta', 'Okta', 'client-id', $2, $3, $4, true, 'acme.test')`,
      [rows[0]?.workspace_id, sealed.ciphertext, sealed.dataKey, sealed.keyId],
    );
  };

  it("is refused with the enforcement sentence before any session ends", async () => {
    const enforcedCookie = await signUp(ENFORCED);
    const other = cookieFrom(await signIn(ENFORCED, PASSWORD));
    const userId = await userIdOf(ENFORCED);
    await enforce(userId);

    const response = await change(
      {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        revokeOtherSessions: true,
      },
      enforcedCookie,
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("SSO_ENFORCED");
    expect(body.message).toBe(
      "Accounts on acme.test sign in with Okta. Use that button on the sign-in page. A password, a reset link and a passkey will not work for this address.",
    );
    expect(await sessionOf(other)).not.toBeNull();
    expect(await audited()).toEqual([]);

    const session = await sessionOf(enforcedCookie);
    expect(
      await passwordCardFor((await workerDb()).appPool, {
        userId,
        email: ENFORCED,
        sessionCreatedAt: session?.session.createdAt as string,
      }),
    ).toEqual({ kind: "enforced", message: body.message });
  });
});

describe("a completed reset", () => {
  it("is recorded and mailed, with every session ended", async () => {
    const requested = await send("POST", "/request-password-reset", {
      email: EMAIL,
      redirectTo: `${BASE_URL}/reset-password`,
    });
    expect(requested.status).toBe(200);
    const token =
      new URL(resetLinks.at(-1) ?? "").pathname.split("/").at(-1) ?? "";
    const reset = await send("POST", "/reset-password", {
      newPassword: NEW_PASSWORD,
      token,
    });
    expect(reset.status).toBe(200);

    const userId = await userIdOf(EMAIL);
    expect(await audited()).toEqual([
      { userId, via: "reset", otherSessionsEnded: true, address: HERE },
    ]);
    expect(await queued()).toEqual([
      expect.objectContaining({ userId, to: EMAIL, via: "reset" }),
    ]);
  });
});

describe("what is not a change", () => {
  it("a sign-up writes no row and queues no mail", async () => {
    await signUp("second@example.com");
    expect(await audited()).toEqual([]);
    expect(await queued()).toEqual([]);
  });
});

describe("Set a password, for an account with none", () => {
  const MINUTE = 60 * 1000;

  /**
   * The account as single sign-on leaves it: no password, and a link to the
   * provider its workspace configured.
   */
  const withoutPassword = async () => {
    const wb = await workerDb();
    const userId = await userIdOf(EMAIL);
    await wb.admin.query(
      "update accounts set password = null where user_id = $1 and provider_id = 'credential'",
      [userId],
    );
    const { rows } = await wb.admin.query<{ workspace_id: string }>(
      "select workspace_id from workspace_members where user_id = $1",
      [userId],
    );
    const workspaceId = rows[0]?.workspace_id as string;
    const sealed = encryptSecret(ring, "a-client-secret");
    await wb.admin.query(
      `insert into sso_connections
         (workspace_id, provider_id, display_name, client_id,
          secret_ciphertext, secret_data_key, secret_key_id, enforce,
          email_domains)
       values ($1, 'okta', 'Okta', 'client-id', $2, $3, $4, false, '')`,
      [workspaceId, sealed.ciphertext, sealed.dataKey, sealed.keyId],
    );
    const providerId = derivedProviderId("okta", workspaceId);
    await wb.admin.query(
      `insert into accounts (id, account_id, provider_id, user_id, created_at, updated_at)
       values ('okta-link', 'okta-subject', $1, $2, now(), now())`,
      [providerId, userId],
    );
    return { userId, providerId };
  };

  it("offers to sign in again when the session is twenty minutes old, and refuses until then", async () => {
    const { userId, providerId } = await withoutPassword();
    const session = await sessionOf(cookie);
    const later = new Date(
      Date.parse(session?.session.createdAt as string) + 20 * MINUTE,
    );
    const pool = (await workerDb()).appPool;

    expect(
      await passwordCardFor(pool, {
        userId,
        email: EMAIL,
        sessionCreatedAt: session?.session.createdAt as string,
        now: later,
      }),
    ).toEqual({
      kind: "set",
      recent: false,
      providers: [{ id: providerId, displayName: "Okta", kind: "oidc" }],
    });

    expect(
      await setOwnPassword(auth, pool, {
        headers: new Headers({ cookie }),
        newPassword: NEW_PASSWORD,
        now: later,
      }),
    ).toEqual({ ok: false, reason: "not_recent" });
    expect(await audited()).toEqual([]);
  });

  it("sets it within ten minutes of a sign-in, records it and mails the account", async () => {
    const { userId, providerId } = await withoutPassword();
    const pool = (await workerDb()).appPool;
    const session = await sessionOf(cookie);
    expect(
      await passwordCardFor(pool, {
        userId,
        email: EMAIL,
        sessionCreatedAt: session?.session.createdAt as string,
      }),
    ).toMatchObject({ kind: "set", recent: true });

    expect(
      await setOwnPassword(auth, pool, {
        headers: new Headers({ cookie, "x-forwarded-for": HERE }),
        newPassword: NEW_PASSWORD,
      }),
    ).toEqual({
      ok: true,
      providers: [{ id: providerId, displayName: "Okta", kind: "oidc" }],
    });

    expect(await audited()).toEqual([
      { userId, via: "set", otherSessionsEnded: false, address: HERE },
    ]);
    expect(await queued()).toEqual([
      expect.objectContaining({ userId, to: EMAIL, via: "set" }),
    ]);
    expect((await signIn(EMAIL, NEW_PASSWORD)).status).toBe(200);
    expect(
      await passwordCardFor(pool, {
        userId,
        email: EMAIL,
        sessionCreatedAt: session?.session.createdAt as string,
      }),
    ).toEqual({ kind: "change" });
  });

  it("refuses a password outside 12 to 128 characters, and one already set", async () => {
    const pool = (await workerDb()).appPool;
    const headers = new Headers({ cookie });
    expect(
      await setOwnPassword(auth, pool, { headers, newPassword: "elevenchars" }),
    ).toEqual({ ok: false, reason: "too_short" });
    expect(
      await setOwnPassword(auth, pool, {
        headers,
        newPassword: "x".repeat(129),
      }),
    ).toEqual({ ok: false, reason: "too_long" });
    // The account signed up with a password, so it has one.
    expect(
      await setOwnPassword(auth, pool, { headers, newPassword: NEW_PASSWORD }),
    ).toEqual({ ok: false, reason: "already_set" });
    expect(await audited()).toEqual([]);
  });
});

describe("the notice the relay sends", () => {
  const deliver = async (payload: Record<string, unknown>) => {
    const wb = await workerDb();
    const sent: { to: string; subject: string; text: string }[] = [];
    const skipped: string[] = [];
    await dispatchOutbox(
      {
        topic: PASSWORD_CHANGED_TOPIC,
        payload,
        idempotencyKey: "k",
        attempts: 1,
      },
      {
        pool: wb.appPool,
        baseUrl: BASE_URL,
        instanceName: "Northwind OKR",
        sendMail: async (message) => {
          sent.push(message);
        },
        onSkipped: (_delivery, reason) => skipped.push(reason),
      },
    );
    return { sent, skipped };
  };

  it("says when and what happened to the other devices, and links only to the reset request", async () => {
    await change({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });
    const [payload] = await queued();
    const { sent, skipped } = await deliver(payload as Record<string, unknown>);
    expect(skipped).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(EMAIL);
    expect(sent[0]?.subject).toBe("Your Northwind OKR password was changed");
    expect(sent[0]?.text).toContain(`The password for ${EMAIL} was changed on`);
    expect(sent[0]?.text).toContain(
      "Your other devices were signed out. API tokens and connected apps keep working.",
    );
    expect(sent[0]?.text).toContain(`${BASE_URL}/forgot-password`);
    expect(sent[0]?.text).not.toContain(NEW_PASSWORD);
  });

  it("is skipped when the account is gone", async () => {
    const { sent, skipped } = await deliver({
      userId: "no-such-account",
      to: "gone@example.com",
      via: "change",
      otherSessionsEnded: false,
      at: new Date().toISOString(),
    });
    expect(sent).toEqual([]);
    expect(skipped).toEqual(["the account is gone"]);
  });
});
