import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { createSSOConnection, SSOConnectionRejected } from "../src/auth/sso.ts";
import {
  checkDomainRecord,
  hashVerificationToken,
  normaliseDomain,
  recordFor,
} from "../src/auth/sso-domains.ts";
import {
  asOwner,
  auditActions,
  BASE,
  domainRow,
  FakeDns,
  ring,
  seedConnection,
  seedVerifiedDomain,
  workspaceFor,
} from "./sso-domain-fixtures.ts";

/**
 * Proving a domain with DNS: the rules (docs/design/
 * sso-domain-verification.md, rules 1, 2, 3 and 5).
 *
 * The lookup is answered by the fake resolver, so nothing here touches a
 * network. What is held to the record is the action's own answer, the row it
 * left and the audit trail beside it.
 */

let ws: string;
let other: string;
let dns: FakeDns;

const owner = () => asOwner("owner-a", ws, dns);

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  ws = await workspaceFor("owner-a", "Workspace A");
  other = await workspaceFor("owner-b", "Workspace B");
  dns = new FakeDns();
});

afterAll(async () => {
  await (await workerDb()).close();
});

/** The one connection a test seeded, by the id the screen would show. */
const onlyConnectionId = async (): Promise<string> => {
  const [connection] = await callAction(
    await owner(),
    "sso.listConnections",
    {},
  );
  if (!connection) {
    throw new Error("The test seeded no connection.");
  }
  return connection.id;
};

/** Starts verification and publishes what it asked for, as an administrator would. */
const startAndPublish = async (
  workspace: string,
  user: string,
  domain: string,
) => {
  const started = await callAction(
    await asOwner(user, workspace, dns),
    "sso.startDomainVerification",
    { domain },
  );
  dns.publish(started.record.name, started.record.value);
  return started;
};

describe("the record", () => {
  it("is a TXT at _openokr-verify.<domain> carrying the token", () => {
    expect(recordFor("example.com", "abc")).toEqual({
      type: "TXT",
      name: "_openokr-verify.example.com",
      value: "openokr-verify=abc",
    });
  });

  it("matches only the token whose hash is stored, across chunks", async () => {
    const hash = hashVerificationToken("tok-123");
    const check = (...records: string[][]) => {
      const fake = new FakeDns();
      for (const chunks of records) {
        fake.publish("_openokr-verify.a.example", ...chunks);
      }
      return checkDomainRecord(fake, "a.example", hash);
    };

    expect(await check(["openokr-verify=tok-123"])).toBe("match");
    expect(await check(["openokr-verify=tok-", "123"])).toBe("match");
    expect(await check(["v=spf1 -all"], ["openokr-verify=tok-123"])).toBe(
      "match",
    );
    expect(await check(["openokr-verify=other"])).toBe("mismatch");
    expect(await check(["v=spf1 -all"])).toBe("missing");
    expect(await check()).toBe("missing");
  });

  it("reports a resolver that did not answer as unavailable, not as missing", async () => {
    const down = new FakeDns().fail();
    expect(await checkDomainRecord(down, "a.example", "00".repeat(32))).toBe(
      "unavailable",
    );
  });

  it("normalises what an administrator types and refuses what is not a domain", () => {
    expect(normaliseDomain("  Example.COM ")).toBe("example.com");
    expect(normaliseDomain("@example.com")).toBeNull();
    expect(normaliseDomain("https://example.com")).toBeNull();
    expect(normaliseDomain("acme")).toBeNull();
  });
});

describe("starting and verifying", () => {
  it("stores the hash of the token and never the token", async () => {
    const started = await callAction(
      await owner(),
      "sso.startDomainVerification",
      { domain: "Example.com" },
    );

    expect(started.domain).toBe("example.com");
    expect(started.record.value).toBe(`openokr-verify=${started.token}`);
    const row = await domainRow(ws, "example.com");
    expect(row?.token_hash).toBe(hashVerificationToken(started.token));
    expect(JSON.stringify(row)).not.toContain(started.token);
    const recorded = (await auditActions()).join();
    expect(recorded).toContain("sso.startDomainVerification");
  });

  it("verifies a domain whose record is published, and lists it verified", async () => {
    await startAndPublish(ws, "owner-a", "example.com");

    const result = await callAction(await owner(), "sso.verifyDomain", {
      domain: "example.com",
    });

    expect(result).toEqual({
      domain: "example.com",
      verified: true,
      reason: null,
    });
    const row = await domainRow(ws, "example.com");
    expect(row?.verified_at).not.toBeNull();
    expect(row?.verified_by).toBe("dns");
    const [listed] = await callAction(await owner(), "sso.listDomains", {});
    expect(listed).toMatchObject({
      domain: "example.com",
      status: "verified",
      verifiedBy: "dns",
    });
    expect(await auditActions()).toContain("sso.verifyDomain");
  });

  it("says why when the record is missing, wrong or the resolver is down, and verifies nothing", async () => {
    await callAction(await owner(), "sso.startDomainVerification", {
      domain: "example.com",
    });
    const verify = async () =>
      (await callAction(await owner(), "sso.verifyDomain", {
        domain: "example.com",
      })) as { verified: boolean; reason: string | null };

    expect(await verify()).toMatchObject({ reason: "record_missing" });
    dns.publish("_openokr-verify.example.com", "openokr-verify=not-the-token");
    expect(await verify()).toMatchObject({ reason: "record_mismatch" });
    dns.fail();
    expect(await verify()).toMatchObject({ reason: "lookup_failed" });

    expect((await domainRow(ws, "example.com"))?.verified_at).toBeNull();
  });

  it("needs verification started first", async () => {
    await expect(
      callAction(await owner(), "sso.verifyDomain", { domain: "example.com" }),
    ).rejects.toMatchObject({ field: "domain" });
  });

  it("refuses to start on a domain that is already verified", async () => {
    await startAndPublish(ws, "owner-a", "example.com");
    await callAction(await owner(), "sso.verifyDomain", {
      domain: "example.com",
    });

    await expect(
      callAction(await owner(), "sso.startDomainVerification", {
        domain: "example.com",
      }),
    ).rejects.toBeInstanceOf(SSOConnectionRejected);
  });

  it("issues a new token when started again before it verified", async () => {
    const first = await callAction(
      await owner(),
      "sso.startDomainVerification",
      { domain: "example.com" },
    );
    const second = await callAction(
      await owner(),
      "sso.startDomainVerification",
      { domain: "example.com" },
    );

    expect(second.token).not.toBe(first.token);
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from sso_domains where workspace_id = $1",
      [ws],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe("rule 1: free-mail domains can never be verified", () => {
  it("refuses gmail.com at start and at verify, with the reason", async () => {
    await expect(
      callAction(await owner(), "sso.startDomainVerification", {
        domain: "gmail.com",
      }),
    ).rejects.toMatchObject({
      field: "domain",
      message: expect.stringMatching(/free email provider/),
    });
    await expect(
      callAction(await owner(), "sso.verifyDomain", { domain: "gmail.com" }),
    ).rejects.toMatchObject({ field: "domain" });
    expect(await domainRow(ws, "gmail.com")).toBeUndefined();
  });
});

describe("rule 2: one verified owner per domain per instance", () => {
  it("refuses a second workspace, naming neither", async () => {
    await startAndPublish(ws, "owner-a", "example.com");
    await callAction(await owner(), "sso.verifyDomain", {
      domain: "example.com",
    });

    // The second workspace publishes a record of its own and still loses.
    await startAndPublish(other, "owner-b", "example.com");
    const refused = callAction(
      await asOwner("owner-b", other, dns),
      "sso.verifyDomain",
      { domain: "example.com" },
    );

    await expect(refused).rejects.toBeInstanceOf(SSOConnectionRejected);
    await expect(refused).rejects.toMatchObject({
      message: expect.not.stringMatching(/Workspace [AB]/),
    });
    expect((await domainRow(other, "example.com"))?.verified_at).toBeNull();
  });

  it("treats a subdomain as another domain", async () => {
    await startAndPublish(ws, "owner-a", "example.com");
    await callAction(await owner(), "sso.verifyDomain", {
      domain: "example.com",
    });
    await startAndPublish(other, "owner-b", "mail.example.com");

    const result = await callAction(
      await asOwner("owner-b", other, dns),
      "sso.verifyDomain",
      { domain: "mail.example.com" },
    );

    expect(result.verified).toBe(true);
  });

  it("lets a domain be verified again once its owner lost it", async () => {
    await seedVerifiedDomain(ws, "example.com");
    const wb = await workerDb();
    await wb.admin.query(
      "update sso_domains set verified_at = null, verified_by = null",
    );
    await startAndPublish(other, "owner-b", "example.com");

    const result = await callAction(
      await asOwner("owner-b", other, dns),
      "sso.verifyDomain",
      { domain: "example.com" },
    );

    expect(result.verified).toBe(true);
  });
});

describe("rule 3: enforce needs every domain verified", () => {
  it("refuses turning enforcement on while a domain is unverified, naming it", async () => {
    await seedConnection(ws, {
      emailDomains: "a.example, b.example",
      enforce: false,
    });
    await seedVerifiedDomain(ws, "a.example");
    const connection = { id: await onlyConnectionId() };

    const refused = callAction(await owner(), "sso.updateConnection", {
      id: connection.id,
      enforce: true,
    });

    await expect(refused).rejects.toMatchObject({
      field: "enforce",
      message: expect.stringContaining("b.example"),
    });
  });

  it("allows it once every domain is verified, and saving an unverified domain without enforcing", async () => {
    await seedConnection(ws, { emailDomains: "a.example", enforce: false });
    await seedVerifiedDomain(ws, "a.example");
    const connection = { id: await onlyConnectionId() };

    const saved = await callAction(await owner(), "sso.updateConnection", {
      id: connection.id,
      emailDomains: "a.example, b.example",
    });
    expect(saved.enforce).toBe(false);

    const refused = callAction(await owner(), "sso.updateConnection", {
      id: connection.id,
      enforce: true,
    });
    await expect(refused).rejects.toMatchObject({ field: "enforce" });

    await seedVerifiedDomain(ws, "b.example");
    const enforced = await callAction(await owner(), "sso.updateConnection", {
      id: connection.id,
      enforce: true,
    });
    expect(enforced.enforce).toBe(true);
  });

  it("refuses a free-mail domain on an enforcing connection, because it can never be verified", async () => {
    await seedConnection(ws, { emailDomains: "gmail.com", enforce: false });
    const connection = { id: await onlyConnectionId() };

    await expect(
      callAction(await owner(), "sso.updateConnection", {
        id: connection.id,
        enforce: true,
      }),
    ).rejects.toMatchObject({ field: "enforce" });
  });

  it("holds for a new connection too", async () => {
    const wb = await workerDb();
    const input = {
      kind: "oidc" as const,
      providerId: "okta",
      displayName: "Okta",
      clientId: "client",
      clientSecret: "secret",
      discoveryUrl: "https://idp.example/.well-known/openid-configuration",
      emailDomains: "acme.example",
      enforce: true,
    };

    await expect(
      createSSOConnection(wb.appPool, ws, ring, input, BASE),
    ).rejects.toMatchObject({ field: "enforce" });

    await seedVerifiedDomain(ws, "acme.example");
    const created = await createSSOConnection(
      wb.appPool,
      ws,
      ring,
      input,
      BASE,
    );
    expect(created.id).toBeTruthy();
  });

  it("leaves an enforcing connection from before this alone: it keeps enforcing, and an edit that adds no domain is not refused", async () => {
    // Decision 2: nothing was ever verified on an instance upgrading to this.
    await seedConnection(ws, { emailDomains: "old.example", enforce: true });
    const connection = { id: await onlyConnectionId() };

    const renamed = await callAction(await owner(), "sso.updateConnection", {
      id: connection.id,
      displayName: "Renamed",
    });
    expect(renamed).toMatchObject({ displayName: "Renamed", enforce: true });

    // A domain it adds does have to be proved.
    await expect(
      callAction(await owner(), "sso.updateConnection", {
        id: connection.id,
        emailDomains: "old.example, new.example",
      }),
    ).rejects.toMatchObject({ field: "enforce" });
  });
});

describe("the list the screen reads", () => {
  it("has domains a connection lists with nothing started, and only this workspace's own", async () => {
    await seedConnection(ws, {
      emailDomains: "a.example, gmail.com",
      enforce: false,
    });
    await callAction(await owner(), "sso.startDomainVerification", {
      domain: "b.example",
    });
    await seedVerifiedDomain(other, "theirs.example");

    const listed = await callAction(await owner(), "sso.listDomains", {});

    expect(listed.map((d) => [d.domain, d.status, d.onConnection])).toEqual([
      ["a.example", "not_started", true],
      ["b.example", "unverified", false],
      ["gmail.com", "not_started", true],
    ]);
    expect(listed.find((d) => d.domain === "gmail.com")?.freeMail).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("token_hash");
  });

  it("is refused below full", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Ordinary', 'human', 'active')
       returning id`,
      [ws],
    );
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId: ws,
          actor: { kind: "human", memberId: rows[0]?.id as string },
          ring,
        },
        "sso.listDomains",
        {},
      ),
    ).rejects.toThrow();
  });
});
