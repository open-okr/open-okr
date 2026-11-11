import { workerDb } from "@openokr/test-support/db";
import { signJWT } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  changeOwnEmail,
  emailCardFor,
} from "../src/auth/account-self-service.ts";
import { createAuth } from "../src/auth/auth.ts";
import {
  auditedAddress,
  CHANGE_EMAIL_TOPIC,
  EMAIL_CHANGE_NOTICE_TOPIC,
  EMAIL_CHANGE_TAKEN_TOPIC,
} from "../src/auth/email-change.ts";
import {
  type AuthLimiterStorage,
  inProcessLimiter,
} from "../src/auth/limiter-storage.ts";
import { derivedProviderId } from "../src/auth/sso.ts";
import { DEMO_PERSONAS } from "../src/demo/personas.ts";
import { directoryManagesAccount } from "../src/directory-sync/managed.ts";
import { createSCIMToken } from "../src/directory-sync/tokens.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { encryptSecret, parseKeyRing } from "../src/secrets/key-ring.ts";

/**
 * Changing the sign-in email (docs/design/account-self-service.md §8 Y4,
 * plan 0.8.0 Y4).
 *
 * The request goes through `changeOwnEmail`, which is what the server action
 * calls, with the shared cache stood in by an in-process count. The link is
 * opened through Better Auth's HTTP handler, which is what the browser
 * reaches, so the completion hooks run as they do for a person. SMTP is stood
 * in by the outbox: what the relay would send is the row, and the relay's
 * handlers are driven against those rows at the end.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const EMAIL = "mover@example.com";
const NEW = "moved@example.org";
const PASSWORD = "correct horse battery staple";
const HERE = "203.0.113.10";
const STOLEN = "198.51.100.66";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let auth: Auth;
let cookie: string;
let limits: AuthLimiterStorage;

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
    new Request(
      path.startsWith("http") ? path : `${BASE_URL}/api/auth${path}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          "x-forwarded-for": options.address ?? HERE,
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      },
    ),
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

const signIn = async (email: string) =>
  cookieFrom(
    await send("POST", "/sign-in/email", { email, password: PASSWORD }),
  );

const build = (canSendMail: boolean) =>
  createAuth({
    pool: workerDbPool(),
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
    canSendMail,
  });

let pool: Awaited<ReturnType<typeof workerDb>>["appPool"];
const workerDbPool = () => pool;

/** One request, as the server action makes it. */
const ask = (
  newEmail: string,
  options: {
    cookie?: string;
    password?: string;
    address?: string;
    now?: Date;
  } = {},
) =>
  changeOwnEmail(auth, pool, {
    headers: new Headers({
      cookie: options.cookie ?? cookie,
      "x-forwarded-for": options.address ?? HERE,
    }),
    newEmail,
    password: options.password ?? PASSWORD,
    limits,
    ...(options.now ? { now: options.now } : {}),
  });

const userIdOf = async (email: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  return rows[0]?.id as string;
};

const workspaceOf = async (userId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ workspace_id: string }>(
    "select workspace_id from workspace_members where user_id = $1",
    [userId],
  );
  return rows[0]?.workspace_id as string;
};

const emailOf = async (userId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    email: string;
    email_verified: boolean;
  }>("select email, email_verified from users where id = $1", [userId]);
  return rows[0];
};

const queued = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    topic: string;
    payload: Record<string, unknown>;
  }>(
    `select topic, payload from outbox
      where topic in ($1, $2, $3)
      order by created_at, id`,
    [CHANGE_EMAIL_TOPIC, EMAIL_CHANGE_NOTICE_TOPIC, EMAIL_CHANGE_TAKEN_TOPIC],
  );
  return rows;
};

const audited = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    action: string;
    payload: Record<string, unknown>;
  }>(
    `select action, payload from instance_audit_events
      where action like 'auth.email%' order by seq`,
  );
  return rows;
};

const setPolicy = async (policy: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', to_jsonb($1::text), 'admin')
     on conflict (key) do update set value = excluded.value`,
    [policy],
  );
};

/** The link the relay would send, as queued. */
const linkFor = async (to: string) => {
  const rows = await queued();
  const row = rows.find(
    (one) => one.topic === CHANGE_EMAIL_TOPIC && one.payload.to === to,
  );
  return String(row?.payload.url ?? "");
};

const open = (url: string, withCookie?: string) =>
  send("GET", url, undefined, withCookie ? { cookie: withCookie } : {});

const timed = async <T>(run: () => Promise<T>) => {
  const started = performance.now();
  const result = await run();
  return { result, ms: performance.now() - started };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  pool = wb.appPool;
  // Open, so the other accounts these cases need can sign up after the first
  // claims the instance. The address rule has its own cases below.
  await setPolicy("open");
  limits = inProcessLimiter();
  auth = build(true);
  // The first account claims the instance, so it arrives confirmed.
  cookie = await signUp(EMAIL);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("where mail cannot be sent", () => {
  it("is not offered: the card says why and the request is refused", async () => {
    auth = build(false);
    const userId = await userIdOf(EMAIL);
    expect(
      await emailCardFor(pool, {
        userId,
        email: EMAIL,
        canSendMail: false,
        sessionCreatedAt: new Date(),
      }),
    ).toEqual({ kind: "no_mail" });
    expect(await ask(NEW)).toEqual({ ok: false, reason: "no_mail" });
    expect(await queued()).toEqual([]);
    expect(await audited()).toEqual([]);
  });
});

describe("asking for a change", () => {
  it("sends a link to a free address, tells the current one, records it, and changes nothing yet", async () => {
    const userId = await userIdOf(EMAIL);
    const { result, ms } = await timed(() => ask(NEW));
    expect(result).toEqual({ ok: true, to: NEW, current: EMAIL, hours: 24 });
    expect(ms).toBeGreaterThanOrEqual(495);

    const rows = await queued();
    expect(rows.map((row) => row.topic).sort()).toEqual(
      [CHANGE_EMAIL_TOPIC, EMAIL_CHANGE_NOTICE_TOPIC].sort(),
    );
    const link = rows.find((row) => row.topic === CHANGE_EMAIL_TOPIC);
    expect(link?.payload).toMatchObject({ userId, from: EMAIL, to: NEW });
    expect(String(link?.payload.url)).toContain(
      `${BASE_URL}/api/auth/verify-email?token=`,
    );
    const notice = rows.find((row) => row.topic === EMAIL_CHANGE_NOTICE_TOPIC);
    expect(notice?.payload).toMatchObject({
      userId,
      to: EMAIL,
      newEmail: NEW,
    });

    const target = auditedAddress(SECRET, NEW);
    expect(await audited()).toEqual([
      {
        action: "auth.email_change_requested",
        payload: {
          userId,
          toDomain: "example.org",
          toKey: target.key,
          outcome: "link_sent",
        },
      },
    ]);
    expect(JSON.stringify(await audited())).not.toContain(NEW);
    expect((await emailOf(userId))?.email).toBe(EMAIL);
  });

  it("answers the same for an address another account holds, no sooner, and tells that address nothing changed", async () => {
    await signUp(NEW);
    const userId = await userIdOf(EMAIL);
    const { result, ms } = await timed(() => ask(NEW));
    expect(result).toEqual({ ok: true, to: NEW, current: EMAIL, hours: 24 });
    expect(ms).toBeGreaterThanOrEqual(495);

    const rows = await queued();
    expect(rows.map((row) => row.topic).sort()).toEqual(
      [EMAIL_CHANGE_NOTICE_TOPIC, EMAIL_CHANGE_TAKEN_TOPIC].sort(),
    );
    expect(
      rows.find((row) => row.topic === EMAIL_CHANGE_TAKEN_TOPIC)?.payload,
    ).toMatchObject({ to: NEW });
    expect(
      rows.find((row) => row.topic === EMAIL_CHANGE_NOTICE_TOPIC)?.payload,
    ).toMatchObject({ userId, to: EMAIL, newEmail: NEW });
    expect(await audited()).toEqual([
      expect.objectContaining({
        action: "auth.email_change_requested",
        payload: expect.objectContaining({ outcome: "address_taken" }),
      }),
    ]);
    expect((await emailOf(userId))?.email).toBe(EMAIL);
  });

  it("refuses the current address, and one that is not an address", async () => {
    expect(await ask(EMAIL.toUpperCase())).toEqual({
      ok: false,
      reason: "same",
    });
    expect(await ask("not an address")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await queued()).toEqual([]);
  });

  it("refuses a free mail address where only company addresses are accepted, and not under invitation only (AS-Q2)", async () => {
    await setPolicy("company_domains");
    expect(await ask("somebody@gmail.com")).toEqual({
      ok: false,
      reason: "company",
    });
    expect(await ask("somebody@company.example")).toMatchObject({ ok: true });

    await setPolicy("invite_only");
    expect(await ask("somebody@gmail.com")).toMatchObject({ ok: true });
  });

  it("refuses a wrong password and counts it toward the sign-in hold", async () => {
    for (let index = 0; index < 5; index++) {
      expect(
        await ask(NEW, { password: `guess-${index}`, address: STOLEN }),
      ).toEqual({ ok: false, reason: "wrong_password" });
    }
    expect(await ask(NEW, { address: STOLEN })).toMatchObject({
      ok: false,
      reason: "held",
    });
    expect(await queued()).toEqual([]);
    expect(await audited()).toEqual([]);
  });
});

describe("what refuses before any address is typed", () => {
  it("a demonstration account", async () => {
    const demo = DEMO_PERSONAS[0]?.email as string;
    const demoCookie = await signUp(demo);
    const userId = await userIdOf(demo);
    expect(
      await emailCardFor(pool, {
        userId,
        email: demo,
        canSendMail: true,
        sessionCreatedAt: new Date(),
      }),
    ).toEqual({ kind: "demo" });
    expect(await ask(NEW, { cookie: demoCookie })).toEqual({
      ok: false,
      reason: "demo",
    });
  });

  it("an account a directory manages, until its token is revoked (AS-Q3)", async () => {
    const userId = await userIdOf(EMAIL);
    await createSCIMToken(pool, await workspaceOf(userId));
    const card = () =>
      emailCardFor(pool, {
        userId,
        email: EMAIL,
        canSendMail: true,
        sessionCreatedAt: new Date(),
      });
    expect(await card()).toEqual({ kind: "directory" });
    expect(await ask(NEW)).toEqual({ ok: false, reason: "directory" });

    const wb = await workerDb();
    await wb.admin.query("update directory_sync_tokens set revoked_at = now()");
    expect(await card()).toMatchObject({ kind: "change", hasPassword: true });
  });

  it("an account single sign-on claims", async () => {
    const enforced = "member@acme.test";
    const enforcedCookie = await signUp(enforced);
    const userId = await userIdOf(enforced);
    const sealed = encryptSecret(ring, "a-client-secret");
    const wb = await workerDb();
    await wb.admin.query(
      `insert into sso_connections
         (workspace_id, provider_id, display_name, client_id,
          secret_ciphertext, secret_data_key, secret_key_id, enforce,
          email_domains)
       values ($1, 'okta', 'Okta', 'client-id', $2, $3, $4, true, 'acme.test')`,
      [
        await workspaceOf(userId),
        sealed.ciphertext,
        sealed.dataKey,
        sealed.keyId,
      ],
    );
    expect(
      await emailCardFor(pool, {
        userId,
        email: enforced,
        canSendMail: true,
        sessionCreatedAt: new Date(),
      }),
    ).toEqual({ kind: "enforced", provider: "Okta", domain: "acme.test" });
    // Its session was made before enforcement began, so it still reads.
    expect(await ask(NEW, { cookie: enforcedCookie })).toEqual({
      ok: false,
      reason: "enforced",
      provider: "Okta",
      domain: "acme.test",
    });
  });
});

describe("an account with no password", () => {
  const MINUTE = 60 * 1000;

  it("needs a sign-in in the last ten minutes, and offers its providers until then", async () => {
    const userId = await userIdOf(EMAIL);
    const wb = await workerDb();
    await wb.admin.query(
      "update accounts set password = null where user_id = $1 and provider_id = 'credential'",
      [userId],
    );
    const workspaceId = await workspaceOf(userId);
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
    const later = new Date(Date.now() + 20 * MINUTE);
    const providers = [{ id: providerId, displayName: "Okta", kind: "oidc" }];

    expect(
      await emailCardFor(pool, {
        userId,
        email: EMAIL,
        canSendMail: true,
        sessionCreatedAt: new Date(),
        now: later,
      }),
    ).toEqual({ kind: "change", hasPassword: false, recent: false, providers });
    expect(await ask(NEW, { password: "", now: later })).toEqual({
      ok: false,
      reason: "not_recent",
      providers,
    });

    expect(await ask(NEW, { password: "" })).toMatchObject({ ok: true });
  });
});

describe("the daily limits", () => {
  it("allows three requests a day from one account", async () => {
    for (const to of ["a1@example.org", "a2@example.org", "a3@example.org"]) {
      expect(await ask(to)).toMatchObject({ ok: true });
    }
    expect(await ask("a4@example.org")).toEqual({
      ok: false,
      reason: "account_limit",
    });
  });

  it("allows three requests a day for one address, whether or not it has an account", async () => {
    for (const [name, target] of [
      ["free", "free@example.org"],
      ["held", "held@example.org"],
    ] as const) {
      if (name === "held") {
        await signUp(target);
      }
      for (let index = 0; index < 3; index++) {
        const asker = `asker-${name}-${index}@example.com`;
        expect(
          await ask(target, { cookie: await signUp(asker) }),
        ).toMatchObject({ ok: true });
      }
      const fourth = `fourth-${name}@example.com`;
      expect(await ask(target, { cookie: await signUp(fourth) })).toEqual({
        ok: false,
        reason: "address_limit",
      });
    }
  });
});

describe("opening the link", () => {
  it("signed in to the account: the address changes, stays confirmed, and is recorded once as a change", async () => {
    const userId = await userIdOf(EMAIL);
    expect((await emailOf(userId))?.email_verified).toBe(true);
    await ask(NEW);
    const response = await open(await linkFor(NEW), cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/account?emailChange=changed",
    );

    expect(await emailOf(userId)).toEqual({
      email: NEW,
      email_verified: true,
    });
    const rows = await audited();
    expect(rows.map((row) => row.action)).toEqual([
      "auth.email_change_requested",
      "auth.email_changed",
    ]);
    expect(rows[1]?.payload).toEqual({
      userId,
      fromDomain: "example.com",
      fromKey: auditedAddress(SECRET, EMAIL).key,
      toDomain: "example.org",
      toKey: auditedAddress(SECRET, NEW).key,
    });
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
    expect(JSON.stringify(rows)).not.toContain(NEW);

    const wb = await workerDb();
    const { rows: verified } = await wb.admin.query(
      "select 1 from instance_audit_events where action = 'auth.email_verified'",
    );
    expect(verified).toEqual([]);
  });

  it("signed out: nothing changes, and sign-in says to open it again", async () => {
    const userId = await userIdOf(EMAIL);
    await ask(NEW);
    const response = await open(await linkFor(NEW));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/sign-in?notice=email-change",
    );
    expect((await emailOf(userId))?.email).toBe(EMAIL);
  });

  it("in another account's session: refused, and nothing changes", async () => {
    const userId = await userIdOf(EMAIL);
    await ask(NEW);
    const other = await signUp("someone-else@example.com");
    const response = await open(await linkFor(NEW), other);
    expect(response.headers.get("location")).toContain("error=INVALID_USER");
    expect((await emailOf(userId))?.email).toBe(EMAIL);
  });

  it("after the owner changes the password and signs other devices out, changes nothing", async () => {
    const userId = await userIdOf(EMAIL);
    const thief = await signIn(EMAIL);
    expect(await ask(NEW, { cookie: thief })).toMatchObject({ ok: true });

    const changed = await send(
      "POST",
      "/change-password",
      {
        currentPassword: PASSWORD,
        newPassword: "a brand new passphrase of mine",
        revokeOtherSessions: true,
      },
      { cookie },
    );
    expect(changed.status).toBe(200);

    const response = await open(await linkFor(NEW), thief);
    expect(response.headers.get("location")).toBe(
      "/sign-in?notice=email-change",
    );
    expect((await emailOf(userId))?.email).toBe(EMAIL);
  });

  it("an address somebody else signed up with since: nothing changes, and Your account says why", async () => {
    const userId = await userIdOf(EMAIL);
    await ask(NEW);
    await signUp(NEW);
    const response = await open(await linkFor(NEW), cookie);
    expect(response.headers.get("location")).toBe("/account?emailChange=taken");
    expect((await emailOf(userId))?.email).toBe(EMAIL);
    expect(
      (await audited()).filter((row) => row.action === "auth.email_changed"),
    ).toEqual([]);
  });

  it("an account a directory began to manage since: nothing changes", async () => {
    const userId = await userIdOf(EMAIL);
    await ask(NEW);
    await createSCIMToken(pool, await workspaceOf(userId));
    const response = await open(await linkFor(NEW), cookie);
    expect(response.headers.get("location")).toBe(
      "/account?emailChange=directory",
    );
    expect((await emailOf(userId))?.email).toBe(EMAIL);
  });

  it("a link already used: refused as not valid, and recorded only once", async () => {
    await ask(NEW);
    const url = await linkFor(NEW);
    await open(url, cookie);
    // The cookie now carries the new address; the same session opens it again.
    const again = await open(url, cookie);
    expect(again.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(
      (await audited()).filter((row) => row.action === "auth.email_changed"),
    ).toHaveLength(1);
  });

  it("a confirmation link still confirms, and is not mistaken for a change", async () => {
    const second = "second@example.com";
    await signUp(second);
    const userId = await userIdOf(second);
    expect((await emailOf(userId))?.email_verified).toBe(false);
    // The token Better Auth mints for a confirmation link: an address and
    // the account, and no `updateTo`.
    const token = await signJWT({ email: second, userId }, SECRET, 3600);
    const response = await open(
      `${BASE_URL}/api/auth/verify-email?token=${token}&callbackURL=%2Femail-confirmed`,
    );
    expect(response.headers.get("location")).toBe("/email-confirmed");
    expect((await emailOf(userId))?.email_verified).toBe(true);
    expect((await audited()).map((row) => row.action)).toEqual([
      "auth.email_verified",
    ]);
  });
});

describe("the mails the relay sends", () => {
  const deliver = async (topic: string, payload: Record<string, unknown>) => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const skipped: string[] = [];
    await dispatchOutbox(
      { topic, payload, idempotencyKey: "k", attempts: 1 },
      {
        pool,
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

  it("sends the link to the new address, and the notice to the current one", async () => {
    await ask(NEW);
    const rows = await queued();
    const link = rows.find((row) => row.topic === CHANGE_EMAIL_TOPIC);
    const linkMail = await deliver(
      CHANGE_EMAIL_TOPIC,
      link?.payload as Record<string, unknown>,
    );
    expect(linkMail.skipped).toEqual([]);
    expect(linkMail.sent[0]?.to).toBe(NEW);
    expect(linkMail.sent[0]?.text).toContain(String(link?.payload.url));

    const notice = rows.find((row) => row.topic === EMAIL_CHANGE_NOTICE_TOPIC);
    const noticeMail = await deliver(
      EMAIL_CHANGE_NOTICE_TOPIC,
      notice?.payload as Record<string, unknown>,
    );
    expect(noticeMail.sent[0]?.to).toBe(EMAIL);
    expect(noticeMail.sent[0]?.text).toContain(NEW);
    expect(noticeMail.sent[0]?.text).not.toContain("verify-email");
  });

  it("skips a link once the account's address has moved, or the link has expired", async () => {
    await ask(NEW);
    const link = (await queued()).find(
      (row) => row.topic === CHANGE_EMAIL_TOPIC,
    );
    const payload = link?.payload as Record<string, unknown>;
    expect(
      (
        await deliver(CHANGE_EMAIL_TOPIC, {
          ...payload,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })
      ).skipped,
    ).toEqual(["the link has expired"]);
    expect(
      (
        await deliver(CHANGE_EMAIL_TOPIC, {
          ...payload,
          from: "an-older-address@example.com",
        })
      ).skipped,
    ).toEqual(["the account's address has changed"]);
  });

  it("tells an address that already has an account that nothing changed", async () => {
    await signUp(NEW);
    await ask(NEW);
    const taken = (await queued()).find(
      (row) => row.topic === EMAIL_CHANGE_TAKEN_TOPIC,
    );
    const { sent } = await deliver(
      EMAIL_CHANGE_TAKEN_TOPIC,
      taken?.payload as Record<string, unknown>,
    );
    expect(sent[0]?.to).toBe(NEW);
    expect(sent[0]?.text).toContain(
      "It already has an account here, so nothing changed.",
    );
    expect(sent[0]?.text).toContain(`${BASE_URL}/forgot-password`);
  });
});

describe("which accounts a directory manages (AS-Q3)", () => {
  it("an active member of a workspace with a live token, and nobody else", async () => {
    const userId = await userIdOf(EMAIL);
    const workspaceId = await workspaceOf(userId);
    expect(await directoryManagesAccount(pool, userId)).toBe(false);

    await createSCIMToken(pool, workspaceId);
    expect(await directoryManagesAccount(pool, userId)).toBe(true);

    const wb = await workerDb();
    await wb.admin.query(
      "update directory_sync_tokens set expires_at = now() - interval '1 minute'",
    );
    expect(await directoryManagesAccount(pool, userId)).toBe(false);

    await createSCIMToken(pool, workspaceId);
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where user_id = $1",
      [userId],
    );
    expect(await directoryManagesAccount(pool, userId)).toBe(false);
  });
});
