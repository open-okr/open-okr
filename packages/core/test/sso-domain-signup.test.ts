import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { recheckSSODomains } from "../src/auth/sso-domain-recheck.ts";
import { verifiedEnforcedProviderForSignUp } from "../src/auth/sso-enforcement.ts";
import {
  FakeDns,
  seedConnection,
  seedVerifiedDomain,
  workspaceFor,
} from "./sso-domain-fixtures.ts";

/**
 * Refusing a new password sign-up on a verified, enforced domain
 * (docs/design/sso-domain-verification.md, rule 4).
 *
 * Driven through Better Auth's HTTP handler, the surface a browser reaches.
 * `sso-enforcement.test.ts` holds the other half: that a sign-up on a domain
 * nobody verified is not refused.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";

let auth: ReturnType<typeof createAuth>;
let ws: string;

const signUp = (email: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name: email }),
    }),
  );

beforeAll(async () => {
  const wb = await workerDb();
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  // Open, because the first provisioned workspace would otherwise close the
  // instance and every sign-up here would be refused by that rule.
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', '"open"'::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
  );
  ws = await workspaceFor("owner-a", "Workspace A");
});

afterAll(async () => {
  await (await workerDb()).close();
});

describe("a new password sign-up", () => {
  it("is refused on a verified domain its workspace enforces, naming the provider", async () => {
    await seedConnection(ws, { emailDomains: "acme.example", enforce: true });
    await seedVerifiedDomain(ws, "acme.example");

    const response = await signUp("new@acme.example");

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("Okta");
    expect(body).toContain("acme.example");
  });

  it("is not refused on a domain nobody verified, as in 0.7.0", async () => {
    await seedConnection(ws, { emailDomains: "acme.example", enforce: true });

    expect((await signUp("new@acme.example")).status).toBe(200);
  });

  it("is not refused when the verified domain's connection does not enforce", async () => {
    await seedConnection(ws, { emailDomains: "acme.example", enforce: false });
    await seedVerifiedDomain(ws, "acme.example");

    expect((await signUp("new@acme.example")).status).toBe(200);
  });

  it("is not refused because a different workspace verified the domain", async () => {
    const other = await workspaceFor("owner-b", "Workspace B");
    await seedConnection(ws, { emailDomains: "acme.example", enforce: true });
    await seedVerifiedDomain(other, "acme.example");

    expect(
      await verifiedEnforcedProviderForSignUp(
        (await workerDb()).appPool,
        "new@acme.example",
      ),
    ).toBeNull();
  });

  it("is not refused on a subdomain of the verified one", async () => {
    await seedConnection(ws, { emailDomains: "acme.example", enforce: true });
    await seedVerifiedDomain(ws, "acme.example");

    expect((await signUp("new@mail.acme.example")).status).toBe(200);
  });

  it("is allowed again once the domain loses its verification", async () => {
    const wb = await workerDb();
    await seedConnection(ws, { emailDomains: "acme.example", enforce: true });
    await seedVerifiedDomain(ws, "acme.example", { failedChecks: 2 });
    expect((await signUp("first@acme.example")).status).toBe(403);

    await recheckSSODomains(wb.appPool, ws, new FakeDns());

    expect((await signUp("second@acme.example")).status).toBe(200);
  });
});
