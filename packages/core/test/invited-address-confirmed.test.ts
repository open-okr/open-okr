import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { createAuth } from "../src/auth/auth.ts";
import { confirmByAcceptedInvitation } from "../src/auth/invited-address.ts";
import { authLimiterStorage } from "../src/auth/limiter-storage.ts";
import { VERIFY_EMAIL_TOPIC } from "../src/auth/verification-links.ts";
import { INVITE_COOKIE } from "../src/invitations/pending.ts";
import { previewInvite } from "../src/invitations/preview.ts";

/**
 * An invited address arrives confirmed (plan 0.8.0 S5,
 * docs/design/email-verification.md §12).
 *
 * Opening a personal invitation's link proves the inbox exactly as a
 * confirmation link would, so a person who signs up through one with that
 * address is not asked to confirm it a second time. Driven through Better
 * Auth's HTTP handler with confirmation required, which is the only case
 * where the difference shows.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";
const OWNER = "owner@example.com";
const INVITED = "priya@example.com";

/** A limiter store that never refuses: limits are not under test here. */
const cache = {
  async rateLimit() {
    return { allowed: true, remaining: 100, resetSeconds: 60 };
  },
};

let auth: Auth;
let pool: Pool;
let workspaceId: string;
let ownerId: string;

const signUp = (email: string, token?: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        ...(token ? { cookie: `${INVITE_COOKIE}=${token}` } : {}),
      },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: "Someone",
        callbackURL: "/email-confirmed",
      }),
    }),
  );

const signInWithPassword = (email: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

const owner = () => ({
  pool,
  workspaceId,
  actor: { kind: "human" as const, userId: ownerId },
});

const personalLink = async (email: string) =>
  (await callAction(owner(), "invitations.createPersonalLink", { email }))
    .token;

const userRow = async (email: string) => {
  const { rows } = await (await workerDb()).admin.query<{
    id: string;
    verified: boolean;
  }>("select id, email_verified as verified from users where email = $1", [
    email,
  ]);
  return rows[0];
};

const linksQueuedTo = async (email: string) => {
  const { rows } = await (await workerDb()).admin.query<{ n: number }>(
    "select count(*)::int as n from outbox where topic = $1 and payload->>'to' = $2",
    [VERIFY_EMAIL_TOPIC, email],
  );
  return rows[0]?.n ?? 0;
};

const confirmedVia = async () => {
  const { rows } = await (await workerDb()).admin.query<{
    payload: { userId: string; via: string };
  }>(
    "select payload from instance_audit_events where action = 'auth.email_verified' order by seq",
  );
  return rows.map((row) => row.payload);
};

const signedIn = (response: Response) =>
  response.headers
    .getSetCookie()
    .some((cookie) => /session_token=[^;]+/.test(cookie));

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("truncate table instance_audit_events");
  pool = wb.appPool;
  auth = createAuth({
    pool,
    secret: SECRET,
    baseUrl: BASE_URL,
    requireEmailVerification: true,
    rateLimitStorage: authLimiterStorage(cache),
  });
  // The claim arrives confirmed (BUG-028) and provisions the owner's
  // workspace; registration stays open so only the rule under test decides.
  expect((await signUp(OWNER)).status).toBe(200);
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', '"open"'::jsonb, 'admin')`,
  );
  ownerId = (await userRow(OWNER))?.id as string;
  const { rows } = await wb.admin.query<{ workspace_id: string }>(
    "select workspace_id from workspace_members where user_id = $1",
    [ownerId],
  );
  workspaceId = rows[0]?.workspace_id as string;
  await wb.admin.query("truncate table instance_audit_events");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("signing up through an invitation, with confirmation required", () => {
  it("a personal invitation with its own address arrives confirmed and can sign in at once", async () => {
    const token = await personalLink(INVITED);
    const response = await signUp(INVITED, token);
    expect(response.status).toBe(200);
    // With confirmation required Better Auth never signs in at sign-up, so
    // the form signs in with the same password when the account came back
    // confirmed, as the setup wizard's claim does.
    expect(
      ((await response.json()) as { user: { emailVerified: boolean } }).user
        .emailVerified,
    ).toBe(true);
    const signIn = await signInWithPassword(INVITED);
    expect(signIn.status).toBe(200);
    expect(signedIn(signIn)).toBe(true);

    const user = await userRow(INVITED);
    expect(user?.verified).toBe(true);
    expect(await linksQueuedTo(INVITED)).toBe(0);
    expect(await confirmedVia()).toEqual([
      { userId: user?.id, via: "invitation" },
    ]);
  });

  it("the address is compared without case or spaces", async () => {
    const token = await personalLink("Priya@Example.com");
    expect((await signUp(INVITED, token)).status).toBe(200);
    expect((await userRow(INVITED))?.verified).toBe(true);
  });

  it("a personal invitation used with another address confirms nothing", async () => {
    const token = await personalLink(INVITED);
    const response = await signUp("someone-else@example.com", token);
    expect(response.status).toBe(200);
    expect((await signInWithPassword("someone-else@example.com")).status).toBe(
      403,
    );
    expect((await userRow("someone-else@example.com"))?.verified).toBe(false);
    expect(await linksQueuedTo("someone-else@example.com")).toBe(1);
    expect(await confirmedVia()).toEqual([]);
  });

  it("a shared workspace link confirms nothing, since it names no address", async () => {
    const { token } = await callAction(
      owner(),
      "invitations.createWorkspaceLink",
      {},
    );
    const response = await signUp(INVITED, token);
    expect(response.status).toBe(200);
    expect((await signInWithPassword(INVITED)).status).toBe(403);
    expect((await userRow(INVITED))?.verified).toBe(false);
    expect(await linksQueuedTo(INVITED)).toBe(1);
  });
});

describe("accepting a personal invitation while signed in (S5-Q2)", () => {
  const unconfirmed = async () => {
    expect((await signUp(INVITED)).status).toBe(200);
    const user = await userRow(INVITED);
    expect(user?.verified).toBe(false);
    return user?.id as string;
  };

  it("confirms an unconfirmed account whose address it was sent to", async () => {
    const userId = await unconfirmed();
    const invitation = await previewInvite(pool, {
      token: await personalLink(INVITED),
      now: new Date(),
    });
    expect(
      await confirmByAcceptedInvitation(auth, pool, {
        userId,
        email: INVITED,
        emailVerified: false,
        invitation,
      }),
    ).toBe(true);
    expect((await userRow(INVITED))?.verified).toBe(true);
    expect(await confirmedVia()).toEqual([{ userId, via: "invitation" }]);
  });

  it("confirms nothing for an invitation sent to another address", async () => {
    const userId = await unconfirmed();
    const invitation = await previewInvite(pool, {
      token: await personalLink("someone-else@example.com"),
      now: new Date(),
    });
    expect(
      await confirmByAcceptedInvitation(auth, pool, {
        userId,
        email: INVITED,
        emailVerified: false,
        invitation,
      }),
    ).toBe(false);
    expect((await userRow(INVITED))?.verified).toBe(false);
    expect(await confirmedVia()).toEqual([]);
  });

  it("writes nothing for an account already confirmed", async () => {
    const userId = await unconfirmed();
    const invitation = await previewInvite(pool, {
      token: await personalLink(INVITED),
      now: new Date(),
    });
    expect(
      await confirmByAcceptedInvitation(auth, pool, {
        userId,
        email: INVITED,
        emailVerified: true,
        invitation,
      }),
    ).toBe(false);
    expect(await confirmedVia()).toEqual([]);
  });
});
