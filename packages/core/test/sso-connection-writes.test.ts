import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { errorFor } from "../src/api/errors.ts";
import {
  createSSOConnection,
  listSSOProviders,
  loadSSOConnections,
  SSOConnectionRejected,
} from "../src/auth/sso.ts";
import { ssoConfigurationStamp } from "../src/auth/sso-refresh.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import {
  generateSigningPairs,
  type SigningPairs,
} from "./saml-fixture-keys.ts";

/**
 * Changing, turning off and removing a single sign-on connection from the
 * admin screen.
 *
 * `/admin/sso` could add a connection and nothing else, so correcting a client
 * id, rotating a secret or retiring a provider meant somebody running SQL on
 * `sso_connections`. These are the three writes that replace that, each a
 * registered action through the Operation pipeline, and the read the screen
 * lists them with.
 *
 * **Every assertion reads what the rest of the product reads.** The sign-in
 * page's list, the boot and reload path's decrypted providers, the stamp every
 * process watches (completeness review L-15) and the SAML plugin's derived
 * table. A write that changed the row and none of those would pass a test
 * that only read the row back.
 */

const BASE = "https://okr.example";
const OWNER = "sso-writes-owner";
const OTHER = "sso-writes-other";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let workspaceId: string;
let otherWorkspaceId: string;
let keys: SigningPairs;

const as = async (userId: string, workspace: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId: workspace,
  actor: { kind: "human" as const, userId },
  ring,
  baseUrl: BASE,
});

const owner = () => as(OWNER, workspaceId);

const oidc = (over: Record<string, unknown> = {}) => ({
  kind: "oidc" as const,
  providerId: "okta",
  displayName: "Sign in with Okta",
  clientId: "client-one",
  clientSecret: "first-secret",
  discoveryUrl: "https://idp.example/.well-known/openid-configuration",
  emailDomains: "acme.example",
  ...over,
});

const saml = (over: Record<string, unknown> = {}) => ({
  kind: "saml" as const,
  providerId: "entra",
  displayName: "Sign in with Entra",
  samlEntryPoint: "https://idp.example/sso",
  samlIssuer: "https://idp.example/entity",
  samlCertificate: keys.trusted.certificate,
  emailDomains: "acme.example",
  ...over,
});

/** A connection made the way the admin screen's Add button makes one. */
const create = async (
  input: ReturnType<typeof oidc> | ReturnType<typeof saml>,
  workspace = workspaceId,
) => {
  const wb = await workerDb();
  return createSSOConnection(wb.appPool, workspace, ring, input, BASE);
};

/** The stored row, read past the floor, secret columns included. */
const stored = async (id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select * from sso_connections where id = $1",
    [id],
  );
  return rows[0] as Record<string, unknown>;
};

/** The SAML plugin's derived row for a provider, or undefined. */
const derived = async (providerId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select issuer, domain, saml_config from sso_providers where provider_id = $1",
    [providerId],
  );
  return rows[0] as
    | { issuer: string; domain: string; saml_config: string }
    | undefined;
};

/** Everything the pipeline wrote beside the change, as text. */
const everythingRecorded = async (): Promise<string> => {
  const wb = await workerDb();
  const [audit, activity, outbox] = await Promise.all([
    wb.admin.query("select payload::text as t from audit_events"),
    wb.admin.query("select payload::text as t from activities"),
    wb.admin.query("select payload::text as t from outbox"),
  ]);
  return [audit, activity, outbox]
    .flatMap((result) => result.rows.map((row) => String(row.t)))
    .join("\n");
};

beforeAll(() => {
  keys = generateSigningPairs();
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  for (const id of [OWNER, OTHER]) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [id, id, `${id}@example.com`],
    );
  }
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  otherWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OTHER, name: "Other" })
  ).workspaceId;
});

afterAll(async () => {
  keys?.cleanUp();
  const wb = await workerDb();
  await wb.close();
});

describe("the list the screen reads", () => {
  it("has this workspace's connections, turned off ones included, and no secret", async () => {
    const one = await create(oidc());
    await create(oidc({ providerId: "second", displayName: "A second one" }));
    await create(oidc({ providerId: "theirs" }), otherWorkspaceId);
    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: one.id,
      enabled: false,
    });

    const listed = await callAction(await owner(), "sso.listConnections", {});

    expect(listed.map((c) => [c.displayName, c.enabled])).toEqual([
      ["A second one", true],
      ["Sign in with Okta", false],
    ]);
    const okta = listed.find((c) => c.id === one.id);
    expect(okta).toMatchObject({
      kind: "oidc",
      providerId: "okta",
      signInId: one.providerId,
      clientId: "client-one",
      discoveryUrl: "https://idp.example/.well-known/openid-configuration",
    });
    // Neither the secret nor anything sealed from it leaves the server.
    const text = JSON.stringify(listed);
    expect(text).not.toContain("first-secret");
    const row = await stored(one.id);
    expect(text).not.toContain(String(row.secret_ciphertext));
  });

  it("is refused to a member below full", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Ordinary', 'human', 'active')
       returning id`,
      [workspaceId],
    );
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", memberId: rows[0]?.id as string },
          ring,
        },
        "sso.listConnections",
        {},
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("editing a connection", () => {
  it("keeps the stored secret when the secret is left blank", async () => {
    const wb = await workerDb();
    const created = await create(oidc());
    const before = await stored(created.id);

    const edited = await callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      displayName: "Okta, renamed",
      clientId: "client-two",
      clientSecret: "",
      discoveryUrl: "https://idp.example/v2/.well-known/openid-configuration",
    });

    expect(edited.displayName).toBe("Okta, renamed");
    const after = await stored(created.id);
    expect(after.secret_ciphertext).toBe(before.secret_ciphertext);
    expect(after.secret_data_key).toBe(before.secret_data_key);

    const [loaded] = await loadSSOConnections(wb.appPool, ring);
    expect(loaded).toMatchObject({
      displayName: "Okta, renamed",
      clientId: "client-two",
      clientSecret: "first-secret",
      discoveryUrl: "https://idp.example/v2/.well-known/openid-configuration",
    });
  });

  it("keeps it too when the secret is not sent at all", async () => {
    const wb = await workerDb();
    const created = await create(oidc());

    await callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      enforce: true,
    });

    const [loaded] = await loadSSOConnections(wb.appPool, ring);
    expect(loaded?.clientSecret).toBe("first-secret");
    expect(loaded?.enforce).toBe(true);
  });

  it("seals a new secret under the key ring, and writes it nowhere else", async () => {
    const wb = await workerDb();
    const created = await create(oidc());
    const before = await stored(created.id);

    await callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      clientSecret: "second-secret",
    });

    const after = await stored(created.id);
    expect(after.secret_ciphertext).not.toBe(before.secret_ciphertext);
    expect(JSON.stringify(after)).not.toContain("second-secret");
    const [loaded] = await loadSSOConnections(wb.appPool, ring);
    expect(loaded?.clientSecret).toBe("second-secret");

    // The audit row says the secret changed, and never what it became.
    const recorded = await everythingRecorded();
    expect(recorded).toContain("clientSecret");
    expect(recorded).not.toContain("second-secret");
  });

  it("refuses what the add form would refuse, naming the field", async () => {
    const created = await create(oidc({ emailDomains: "" }));

    const enforcingNothing = callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      enforce: true,
    });
    await expect(enforcingNothing).rejects.toBeInstanceOf(
      SSOConnectionRejected,
    );
    await expect(enforcingNothing).rejects.toMatchObject({
      field: "emailDomains",
    });

    await expect(
      callAction(await owner(), "sso.updateConnection", {
        id: created.id,
        discoveryUrl: null,
      }),
    ).rejects.toMatchObject({ field: "discoveryUrl" });

    // Nothing was written by either.
    expect((await stored(created.id)).enforce).toBe(false);
  });

  it("refuses a field that belongs to the other protocol", async () => {
    const created = await create(oidc());
    await expect(
      callAction(await owner(), "sso.updateConnection", {
        id: created.id,
        samlCertificate: keys.trusted.certificate,
      }),
    ).rejects.toMatchObject({ field: "samlCertificate" });
  });

  it("reaches the REST surface as a refusal of the input, not a fault", () => {
    const answer = errorFor(
      new SSOConnectionRejected({ field: "clientId", message: "Give one." }),
    );
    expect(answer).toEqual({
      code: "invalid_input",
      message: "Give one.",
      fields: { clientId: "Give one." },
    });
  });

  it("rewrites the SAML plugin's row, so the next sign-in meets the new settings", async () => {
    const created = await create(saml());
    expect((await derived(created.providerId))?.domain).toBe("acme.example");

    await callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      samlEntryPoint: "https://idp.example/sso-v2",
      samlIssuer: "https://idp.example/entity-v2",
      samlCertificate: keys.stranger.certificate,
      emailDomains: "globex.example, acme.example",
    });

    const row = await derived(created.providerId);
    expect(row?.issuer).toBe("https://idp.example/entity-v2");
    expect(row?.domain).toBe("globex.example");
    const config = JSON.parse(String(row?.saml_config));
    expect(config.entryPoint).toBe("https://idp.example/sso-v2");
    expect(config.idpMetadata.entityID).toBe("https://idp.example/entity-v2");
    // Stored as PEM, whichever shape it was pasted in.
    expect(config.cert).toContain("BEGIN CERTIFICATE");
    expect(config.cert.replace(/\s+/g, "")).toBe(
      keys.stranger.certificate.replace(/\s+/g, ""),
    );
    // This instance, never the identity provider.
    expect(config.issuer).toBe(BASE);
  });
});

describe("turning a connection off and on", () => {
  it("takes it off the sign-in page and out of every process's providers, and puts it back", async () => {
    const wb = await workerDb();
    const created = await create(oidc({ enforce: true }));

    const off = await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: false,
    });
    expect(off.enabled).toBe(false);
    expect(await listSSOProviders(wb.appPool)).toEqual([]);
    expect(await loadSSOConnections(wb.appPool, ring)).toEqual([]);

    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: true,
    });
    const providers = await listSSOProviders(wb.appPool);
    expect(providers.map((p) => p.id)).toEqual([created.providerId]);
    // Nothing else about it moved while it was off.
    expect(providers[0]?.enforce).toBe(true);
    const [loaded] = await loadSSOConnections(wb.appPool, ring);
    expect(loaded?.clientSecret).toBe("first-secret");
  });

  it("removes a SAML provider's plugin row while it is off, and writes it again", async () => {
    const created = await create(saml());

    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: false,
    });
    expect(await derived(created.providerId)).toBeUndefined();

    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: true,
    });
    expect((await derived(created.providerId))?.issuer).toBe(
      "https://idp.example/entity",
    );
  });
});

/**
 * A compromised identity provider has to be switched off whatever state the
 * workspace is in. A freeze collapses every write to view-only except the
 * recovery list, and turning a connection off is on it; changing or removing
 * one is not.
 */
describe.each(["frozen", "read_only"] as const)(
  "in a workspace that is %s",
  (state) => {
    it("a connection can still be turned off and on, and nothing else about it changes", async () => {
      const wb = await workerDb();
      const created = await create(oidc({ enforce: true }));
      await callAction(await owner(), "workspace.setState", { state });

      const off = await callAction(await owner(), "sso.setConnectionEnabled", {
        id: created.id,
        enabled: false,
      });
      expect(off.enabled).toBe(false);
      expect(await listSSOProviders(wb.appPool)).toEqual([]);

      await expect(
        callAction(await owner(), "sso.updateConnection", {
          id: created.id,
          displayName: "Renamed during a freeze",
        }),
      ).rejects.toThrow();
      await expect(
        callAction(await owner(), "sso.removeConnection", { id: created.id }),
      ).rejects.toThrow();

      await callAction(await owner(), "sso.setConnectionEnabled", {
        id: created.id,
        enabled: true,
      });
      expect(
        (await listSSOProviders(wb.appPool)).map((p) => p.displayName),
      ).toEqual(["Sign in with Okta"]);
    });
  },
);

describe("removing a connection", () => {
  it("soft-deletes it, so it is gone from every reader and the row remains", async () => {
    const wb = await workerDb();
    const created = await create(oidc());

    await callAction(await owner(), "sso.removeConnection", {
      id: created.id,
    });

    expect(await callAction(await owner(), "sso.listConnections", {})).toEqual(
      [],
    );
    expect(await listSSOProviders(wb.appPool)).toEqual([]);
    expect(await loadSSOConnections(wb.appPool, ring)).toEqual([]);
    expect((await stored(created.id)).deleted_at).not.toBeNull();
  });

  it("frees its provider ID, so the same callback address can be added again", async () => {
    // The address registered at the identity provider carries the provider
    // ID, so removing a connection and adding it back is how somebody starts
    // over without asking their identity team to change anything.
    const created = await create(oidc());
    await callAction(await owner(), "sso.removeConnection", {
      id: created.id,
    });

    const again = await create(oidc());
    expect(again.providerId).toBe(created.providerId);
  });

  it("takes a SAML provider's plugin row with it", async () => {
    const created = await create(saml());
    await callAction(await owner(), "sso.removeConnection", {
      id: created.id,
    });
    expect(await derived(created.providerId)).toBeUndefined();
  });

  it("cannot be removed twice", async () => {
    const created = await create(oidc());
    await callAction(await owner(), "sso.removeConnection", {
      id: created.id,
    });
    await expect(
      callAction(await owner(), "sso.removeConnection", { id: created.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("another workspace's connection", () => {
  it("answers not-found to every write, and nothing about it changes", async () => {
    const theirs = await create(oidc(), otherWorkspaceId);
    const before = await stored(theirs.id);
    const mine = await owner();

    await expect(
      callAction(mine, "sso.updateConnection", {
        id: theirs.id,
        displayName: "Taken over",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      callAction(mine, "sso.setConnectionEnabled", {
        id: theirs.id,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      callAction(mine, "sso.removeConnection", { id: theirs.id }),
    ).rejects.toMatchObject({ code: "not_found" });

    expect(await stored(theirs.id)).toEqual(before);
  });
});

describe("what every process watches (completeness review L-15)", () => {
  it("moves the stamp on an edit, on off, on on and on removal", async () => {
    const wb = await workerDb();
    const created = await create(oidc());
    const stamps = [await ssoConfigurationStamp(wb.appPool)];
    const stampAfter = async () => {
      stamps.push(await ssoConfigurationStamp(wb.appPool));
      return stamps.at(-1);
    };

    await callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      clientId: "client-two",
    });
    expect(await stampAfter()).not.toBe(stamps.at(-2));

    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: false,
    });
    expect(await stampAfter()).not.toBe(stamps.at(-2));

    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: true,
    });
    expect(await stampAfter()).not.toBe(stamps.at(-2));

    await callAction(await owner(), "sso.removeConnection", {
      id: created.id,
    });
    expect(await stampAfter()).not.toBe(stamps.at(-2));
  });

  it("does not move for an edit to a connection that is off", async () => {
    // Nothing a process holds changed, so nothing should make it reload.
    const wb = await workerDb();
    const created = await create(oidc());
    await callAction(await owner(), "sso.setConnectionEnabled", {
      id: created.id,
      enabled: false,
    });
    const before = await ssoConfigurationStamp(wb.appPool);

    await callAction(await owner(), "sso.updateConnection", {
      id: created.id,
      displayName: "Renamed while off",
    });

    expect(await ssoConfigurationStamp(wb.appPool)).toBe(before);
  });
});

describe("the record each write leaves", () => {
  it("names the acting member on an audit row and a feed row, per write", async () => {
    const wb = await workerDb();
    const created = await create(oidc());
    const mine = await owner();

    await callAction(mine, "sso.updateConnection", {
      id: created.id,
      displayName: "Okta, renamed",
    });
    await callAction(mine, "sso.setConnectionEnabled", {
      id: created.id,
      enabled: false,
    });
    await callAction(mine, "sso.removeConnection", { id: created.id });

    const { rows: member } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER],
    );
    // Sorted rather than ordered by time: three writes a millisecond apart
    // can share a timestamp, and the order is not what is being asked.
    const { rows: audit } = await wb.admin.query<{
      action: string;
      actor_member_id: string;
      target_id: string;
    }>(
      `select action, actor_member_id, target_id from audit_events
        where workspace_id = $1 and action like 'sso.%'`,
      [workspaceId],
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      "sso.removeConnection",
      "sso.setConnectionEnabled",
      "sso.updateConnection",
    ]);
    for (const row of audit) {
      expect(row.actor_member_id).toBe(member[0]?.id);
      expect(row.target_id).toBe(created.id);
    }

    const { rows: feed } = await wb.admin.query<{
      kind: string;
      actor_member_id: string;
    }>(
      `select kind, actor_member_id from activities
        where workspace_id = $1 and kind like 'sso.%'`,
      [workspaceId],
    );
    expect(feed.map((row) => row.kind).sort()).toEqual([
      "sso.connection_removed",
      "sso.connection_switched",
      "sso.connection_updated",
    ]);
    for (const row of feed) {
      expect(row.actor_member_id).toBe(member[0]?.id);
    }
  });
});
