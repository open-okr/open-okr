import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicSSOProviders } from "../src/auth/sso.ts";
import { encryptSecret, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * What an unauthenticated sign-in page may learn about single sign-on
 * (completeness review H-03).
 *
 * The route used to return every enabled connection on the instance with its
 * workspace id, email domains and enforce flag. On the managed cloud that was
 * a public list of every customer and their identity provider. Two
 * workspaces here stand in for two customers.
 */

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const seed = async (
  userId: string,
  providerId: string,
  displayName: string,
  domains: string,
) => {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ($1, $1, $2, true, now(), now())`,
    [userId, `${userId}@example.com`],
  );
  const { workspaceId } = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: userId,
  });
  const sealed = encryptSecret(ring, "a-client-secret");
  await wb.admin.query(
    `insert into sso_connections
       (workspace_id, provider_id, display_name, discovery_url, client_id,
        secret_ciphertext, secret_data_key, secret_key_id, enforce,
        email_domains)
     values ($1, $2, $3, 'https://idp.example.com/.well-known/openid-configuration',
             'client-id', $4, $5, $6, true, $7)`,
    [
      workspaceId,
      providerId,
      displayName,
      sealed.ciphertext,
      sealed.dataKey,
      sealed.keyId,
      domains,
    ],
  );
  return workspaceId;
};

let acmeWorkspace: string;

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  acmeWorkspace = await seed("sso-acme", "okta", "Acme sign-in", "acme.com");
  await seed("sso-globex", "entra", "Globex sign-in", "globex.com, globex.io");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("publicSSOProviders on the managed cloud", () => {
  it("lists nothing to a visitor who has given no address", async () => {
    const wb = await workerDb();
    expect(await publicSSOProviders(wb.appPool, { cloud: true })).toEqual([]);
  });

  it("gives an address only the provider for its own domain", async () => {
    const wb = await workerDb();
    const providers = await publicSSOProviders(wb.appPool, {
      cloud: true,
      email: "Priya@Globex.IO",
    });
    expect(providers.map((provider) => provider.displayName)).toEqual([
      "Globex sign-in",
    ]);
  });

  it("gives an address with no provider nothing", async () => {
    const wb = await workerDb();
    expect(
      await publicSSOProviders(wb.appPool, {
        cloud: true,
        email: "someone@initech.com",
      }),
    ).toEqual([]);
  });
});

describe("publicSSOProviders on a self-hosted instance", () => {
  it("lists the instance's own providers before an address is typed", async () => {
    const wb = await workerDb();
    const providers = await publicSSOProviders(wb.appPool, { cloud: false });
    expect(providers.map((provider) => provider.displayName).sort()).toEqual([
      "Acme sign-in",
      "Globex sign-in",
    ]);
  });
});

describe("what any answer carries", () => {
  it("names a provider and its protocol, and nothing that identifies a customer", async () => {
    const wb = await workerDb();
    const [provider] = await publicSSOProviders(wb.appPool, {
      cloud: true,
      email: "someone@acme.com",
    });
    expect(provider).toBeDefined();
    expect(Object.keys(provider ?? {}).sort()).toEqual([
      "displayName",
      "id",
      "kind",
    ]);
    const serialised = JSON.stringify(provider);
    expect(serialised).not.toContain(acmeWorkspace);
    expect(serialised).not.toContain("acme.com");
    expect(serialised).not.toContain("a-client-secret");
  });
});
