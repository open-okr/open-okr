import { createHash } from "node:crypto";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSSOProviders, loadSSOConnections } from "../src/auth/sso.ts";
import { createSCIMToken, resolveToken } from "../src/directory-sync/tokens.ts";
import { encryptSecret, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The tenant floor and the reads that run before a workspace is known
 * (P8-T07a).
 *
 * **Every test here failed when it was written**, against the code P8-T07 and
 * P8-T08 shipped. The application role is `nosuperuser nobypassrls` and owns
 * nothing, both tables carry `force row level security`, and all three reads
 * ran with no tenant setting, so single sign-on could never have been
 * configured and no SCIM request could ever have been accepted. Returning no
 * rows is what a correct tenant floor looks like from above, which is why
 * nothing failed loudly and no gate noticed.
 *
 * The last two tests are the other half: a floor that is opened has to be
 * opened narrowly, so they hold the two new settings to the one table and the
 * one row each is meant to reach.
 */

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let workspaceId: string;
let otherWorkspaceId: string;

/** A user row, because a member points at one and Better Auth owns that table. */
async function user(id: string, email: string): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())
     on conflict (id) do nothing`,
    [id, id, email],
  );
}

beforeAll(async () => {
  const wb = await workerDb();
  await user("sso-floor-owner", "sso-floor-owner@example.com");
  await user("sso-floor-other", "sso-floor-other@example.com");

  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "sso-floor-owner",
      name: "Floor Owner",
    })
  ).workspaceId;
  otherWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "sso-floor-other",
      name: "Floor Other",
    })
  ).workspaceId;

  // The connection itself is inserted with the superuser pool rather than
  // through the admin endpoint: that endpoint is a bespoke REST route rather
  // than an action, and this suite is about the floor, not about it.
  const sealed = encryptSecret(ring, "a-client-secret");
  await wb.admin.query(
    `insert into sso_connections
       (workspace_id, provider_id, display_name, discovery_url, client_id,
        secret_ciphertext, secret_data_key, secret_key_id, enforce,
        email_domains)
     values ($1, 'okta', 'Sign in with Okta',
             'https://idp.example.com/.well-known/openid-configuration',
             'client-id', $2, $3, $4, true, 'acme.com')`,
    [workspaceId, sealed.ciphertext, sealed.dataKey, sealed.keyId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the SSO provider list", () => {
  it("is loaded at boot, with the client secret decrypted", async () => {
    const wb = await workerDb();
    const providers = await loadSSOConnections(wb.appPool, ring);

    expect(providers).toHaveLength(1);
    expect(providers[0]?.clientSecret).toBe("a-client-secret");
    expect(providers[0]?.discoveryUrl).toBe(
      "https://idp.example.com/.well-known/openid-configuration",
    );
  });

  it("is readable by the sign-in page, which has no session", async () => {
    const wb = await workerDb();
    const providers = await listSSOProviders(wb.appPool);

    expect(providers).toHaveLength(1);
    expect(providers[0]?.displayName).toBe("Sign in with Okta");
  });

  it("carries no secret to the sign-in page", async () => {
    const wb = await workerDb();
    const [provider] = await listSSOProviders(wb.appPool);

    expect(JSON.stringify(provider)).not.toContain("a-client-secret");
    expect(JSON.stringify(provider)).not.toContain("client-id");
  });
});

describe("a SCIM bearer token", () => {
  it("is created for a workspace and resolves back to it", async () => {
    const wb = await workerDb();
    const created = await createSCIMToken(
      wb.appPool,
      workspaceId,
      "the floor test",
    );

    const resolved = await resolveToken(wb.appPool, created.token);
    expect(resolved?.workspaceId).toBe(workspaceId);
    expect(resolved?.tokenId).toBe(created.id);
  });

  it("stops resolving once a second token replaces it", async () => {
    const wb = await workerDb();
    const first = await createSCIMToken(wb.appPool, otherWorkspaceId);
    const second = await createSCIMToken(wb.appPool, otherWorkspaceId);

    expect(await resolveToken(wb.appPool, first.token)).toBeNull();
    expect((await resolveToken(wb.appPool, second.token))?.workspaceId).toBe(
      otherWorkspaceId,
    );
  });

  it("answers null for a token nobody issued", async () => {
    const wb = await workerDb();
    expect(await resolveToken(wb.appPool, "not-a-token")).toBeNull();
  });
});

describe("what the two new settings do not open", () => {
  it("shows a directory token holder only its own row", async () => {
    const wb = await workerDb();
    const issued = await createSCIMToken(wb.appPool, workspaceId);
    const digest = createHash("sha256").update(issued.token).digest("hex");

    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.directory_token_hash', $1, true)",
        [digest],
      );
      const tokens = await client.query(
        "select workspace_id from directory_sync_tokens",
      );
      // Its own row and no other: not the other workspace's live token, and
      // not the revoked ones this workspace has accumulated above.
      expect(tokens.rows).toHaveLength(1);
      expect(tokens.rows[0]?.workspace_id).toBe(workspaceId);

      // And nothing at all from the tables it does not name.
      const goals = await client.query("select id from goals");
      expect(goals.rows).toHaveLength(0);
      const connections = await client.query("select id from sso_connections");
      expect(connections.rows).toHaveLength(0);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("gives the SSO lookup no write and no other table", async () => {
    const wb = await workerDb();
    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.sso_lookup', 'on', true)");

      const connections = await client.query("select id from sso_connections");
      expect(connections.rows).toHaveLength(1);

      const goals = await client.query("select id from goals");
      expect(goals.rows).toHaveLength(0);
      const members = await client.query("select id from workspace_members");
      expect(members.rows).toHaveLength(0);
      const tokens = await client.query("select id from directory_sync_tokens");
      expect(tokens.rows).toHaveLength(0);

      // The policy is `for select`. A write is refused even with the setting
      // on, which is what keeps this a read key rather than a way in.
      await expect(
        client.query(
          `insert into sso_connections
             (workspace_id, provider_id, display_name, client_id,
              secret_ciphertext, secret_data_key, secret_key_id)
           values ($1, 'smuggled', 'Smuggled', 'id', 'c', 'k', 'key')`,
          [workspaceId],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
