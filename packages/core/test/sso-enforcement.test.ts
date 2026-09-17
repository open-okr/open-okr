import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import {
  enforcedProviderForUser,
  enforcingProviderFor,
  isProviderSignInPath,
} from "../src/auth/sso-enforcement.ts";
import { encryptSecret, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Single-sign-on enforcement (P8-T07a).
 *
 * P8-T07 stored `enforce` and `email_domains` and read them nowhere, so a
 * workspace that switched enforcement on watched password sign-in carry on
 * working. These drive Better Auth through its HTTP handler, which is the
 * surface a browser actually reaches.
 *
 * The matching rules are tested separately and without a database, because
 * what counts as a claimed domain is the part worth being sure of.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;
let workspaceId: string;

const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const signUp = (email: string) =>
  post("/sign-up/email", { email, password: PASSWORD, name: email });

beforeAll(async () => {
  const wb = await workerDb();

  // Registration stays open, because the first provisioned workspace would
  // otherwise close the instance and every sign-up below would be refused by
  // that rule rather than by the one under test.
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', '"open"'::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
  );

  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ('enforce-owner', 'Owner', 'owner@example.com', true, now(), now())
     on conflict (id) do nothing`,
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "enforce-owner",
      name: "Enforcing Workspace",
    })
  ).workspaceId;

  const sealed = encryptSecret(ring, "a-client-secret");
  await wb.admin.query(
    `insert into sso_connections
       (workspace_id, provider_id, display_name, discovery_url, client_id,
        secret_ciphertext, secret_data_key, secret_key_id, enforce,
        email_domains)
     values ($1, 'okta', 'Okta',
             'https://idp.example.com/.well-known/openid-configuration',
             'client-id', $2, $3, $4, true, 'acme.com, acme.co.uk')`,
    [workspaceId, sealed.ciphertext, sealed.dataKey, sealed.keyId],
  );

  // A second connection that enforces with no domains. Migration 0091 reads
  // an empty list as "every member of this workspace", which at the sign-in
  // page would claim every address on the instance. It must claim none.
  await wb.admin.query(
    `insert into sso_connections
       (workspace_id, provider_id, display_name, client_id,
        secret_ciphertext, secret_data_key, secret_key_id, enforce,
        email_domains)
     values ($1, 'entra', 'Entra', 'client-id-2', $2, $3, $4, true, '')`,
    [workspaceId, sealed.ciphertext, sealed.dataKey, sealed.keyId],
  );

  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    // Off, because these tests sign in repeatedly and the lockout is
    // somebody else's subject.
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("which provider claims an address", () => {
  const connections = [
    { providerId: "sso-okta-1", displayName: "Okta", domains: ["acme.com"] },
  ];

  it("claims the domain it names, whatever the case", () => {
    expect(enforcingProviderFor("SOMEONE@Acme.com", connections)).toMatchObject(
      { providerId: "sso-okta-1", domain: "acme.com" },
    );
  });

  it("claims neither a subdomain nor a domain that merely ends the same way", () => {
    expect(enforcingProviderFor("a@mail.acme.com", connections)).toBeNull();
    expect(enforcingProviderFor("a@notacme.com", connections)).toBeNull();
    expect(
      enforcingProviderFor("a@acme.com.evil.test", connections),
    ).toBeNull();
  });

  it("claims nothing when the connection lists no domain", () => {
    expect(
      enforcingProviderFor("a@acme.com", [
        { providerId: "sso-x-1", displayName: "X", domains: [] },
      ]),
    ).toBeNull();
  });
});

describe("an address an enforcing provider claims", () => {
  it("cannot create a local account", async () => {
    const response = await signUp("new@acme.com");

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Okta");
  });

  it("cannot sign in with a password", async () => {
    const wb = await workerDb();
    // The account exists already, which is the case that matters: somebody
    // who had a password before the workspace turned enforcement on.
    await wb.admin.query(
      `insert into users (id, name, email, email_verified, created_at, updated_at)
       values ('enforced-user', 'Enforced', 'enforced@acme.com', true, now(), now())
       on conflict (id) do nothing`,
    );

    const response = await post("/sign-in/email", {
      email: "enforced@acme.com",
      password: PASSWORD,
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("Okta");
    // The refusal says nothing about whether that password was right.
    expect(body).not.toMatch(/invalid|incorrect|wrong/i);
  });

  it("cannot ask for a password reset", async () => {
    const response = await post("/request-password-reset", {
      email: "enforced@acme.com",
      redirectTo: `${BASE_URL}/reset`,
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Okta");
  });

  it("is refused on every domain the connection lists, not just the first", async () => {
    const response = await signUp("someone@acme.co.uk");

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Okta");
  });
});

describe("an address no enforcing provider claims", () => {
  it("signs up and signs in exactly as before", async () => {
    const created = await signUp("free@example.com");
    expect(created.status).toBe(200);

    const signedIn = await post("/sign-in/email", {
      email: "free@example.com",
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
  });

  it("is unaffected by a connection that enforces with no domains", async () => {
    // The second connection in the fixture enforces and lists nothing. If an
    // empty list were read as "everybody", this address would be refused.
    const created = await signUp("also-free@elsewhere.test");
    expect(created.status).toBe(200);
  });
});

describe("the backstop, for the factors that carry no address", () => {
  /**
   * A passkey assertion has no address in it, so the middleware cannot see
   * whose sign-in it is and the session hook is what catches it. A real
   * WebAuthn assertion cannot be produced in this harness, so what is tested
   * here is the decision that hook makes: who it would refuse, and which
   * paths escape it. The hook itself is four lines over these two answers.
   */
  it("recognises an enforced account by id, with no address to hand", async () => {
    const wb = await workerDb();

    expect(
      await enforcedProviderForUser(wb.appPool, "enforced-user"),
    ).toMatchObject({ displayName: "Okta", domain: "acme.com" });
    expect(
      await enforcedProviderForUser(wb.appPool, "enforce-owner"),
    ).toBeNull();
    expect(await enforcedProviderForUser(wb.appPool, "nobody")).toBeNull();
  });

  it("lets the identity provider's own sign-in through and nothing else", () => {
    expect(isProviderSignInPath("/callback/sso-okta-abc12345")).toBe(true);
    expect(isProviderSignInPath("/sign-in/social")).toBe(true);

    expect(isProviderSignInPath("/sign-in/email")).toBe(false);
    expect(isProviderSignInPath("/passkey/verify-authentication")).toBe(false);
    expect(isProviderSignInPath("/two-factor/verify-totp")).toBe(false);
    // A caller that cannot say where it came from gets the stricter answer.
    expect(isProviderSignInPath(undefined)).toBe(false);
    // And a path that merely mentions the callback does not count as one.
    expect(isProviderSignInPath("/evil/callback/x")).toBe(false);
  });
});

describe("enforcement when the workspace turns it off", () => {
  it("stops applying without a restart", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update sso_connections set enforce = false where provider_id = 'okta'",
    );
    try {
      const response = await signUp("after-the-switch@acme.com");
      expect(response.status).toBe(200);
    } finally {
      await wb.admin.query(
        "update sso_connections set enforce = true where provider_id = 'okta'",
      );
    }
  });
});
