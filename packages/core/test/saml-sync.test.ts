import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { domainFor, syncAllSamlProviders, syncSamlProvider } from "../src/auth/saml-sync.ts";
import type { SSOProviderConfig } from "../src/auth/sso.ts";

/**
 * The derived provider table, kept in step with ours (P8-T07c-a).
 *
 * `sso_connections` is the authority and `sso_providers` is derived from it.
 * That is the whole shape of this feature, so these tests are about the one
 * thing derived state can get wrong: disagreeing with its source.
 *
 * **The removals matter more than the writes.** A row written late is a
 * sign-in that fails, which somebody reports. A row left behind after its
 * authority is gone is a provider the product considers deleted still
 * answering sign-ins, which nobody reports because it looks like it works.
 */

const BASE = "https://okr.example";

const saml = (over: Partial<SSOProviderConfig> = {}): SSOProviderConfig => ({
  kind: "saml",
  id: "11111111-1111-4111-8111-111111111111",
  providerId: "sso-okta-abcd1234",
  displayName: "Okta",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  clientId: "unused-for-saml",
  clientSecret: "unused-for-saml",
  scopes: [],
  emailDomains: ["acme.example"],
  enforce: false,
  samlEntryPoint: "https://idp.example/sso",
  samlIssuer: "https://idp.example/entity",
  samlCertificate: "MIIC-not-a-real-certificate",
  samlWantAssertionsSigned: true,
  ...over,
});

const rows = async () => {
  const wb = await workerDb();
  const { rows: found } = await wb.admin.query(
    "select provider_id, issuer, domain, saml_config, oidc_config from sso_providers order by provider_id",
  );
  return found;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from sso_providers");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the domain the plugin matches on", () => {
  it("is the first trusted domain when there is one", () => {
    expect(domainFor(saml())).toBe("acme.example");
  });

  it("falls back to the provider's own host, which matches nobody", () => {
    // The plugin refuses a row with no domain, so something has to go here.
    // The entry point's host matches no email address, which is the right
    // answer for a provider that named no domain. Anything broader would
    // match somebody.
    expect(domainFor(saml({ emailDomains: [] }))).toBe("idp.example");
  });

  it("does not throw on an entry point that is not a URL", () => {
    expect(
      domainFor(saml({ emailDomains: [], samlEntryPoint: "not a url" })),
    ).toBe("invalid.example");
  });
});

describe("syncing one provider", () => {
  it("writes the derived row, with the plugin's own config shape", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);

    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]?.provider_id).toBe("sso-okta-abcd1234");
    expect(found[0]?.issuer).toBe("https://idp.example/entity");
    expect(found[0]?.domain).toBe("acme.example");

    const config = JSON.parse(String(found[0]?.saml_config));
    expect(config.entryPoint).toBe("https://idp.example/sso");
    expect(config.cert).toBe("MIIC-not-a-real-certificate");
    expect(config.wantAssertionsSigned).toBe(true);
    // The callback the identity provider posts back to, on this instance.
    expect(config.callbackUrl).toContain(BASE);
    expect(config.callbackUrl).toContain("sso-okta-abcd1234");
  });

  it("is idempotent, which every boot depends on", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);
    await syncSamlProvider(wb.appPool, saml(), BASE);

    expect(await rows()).toHaveLength(1);
  });

  it("updates in place when the provider changes", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);
    await syncSamlProvider(
      wb.appPool,
      saml({ samlEntryPoint: "https://idp.example/sso-v2" }),
      BASE,
    );

    const found = await rows();
    expect(found).toHaveLength(1);
    expect(JSON.parse(String(found[0]?.saml_config)).entryPoint).toBe(
      "https://idp.example/sso-v2",
    );
  });

  it("removes the row when the provider stops being SAML", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);
    expect(await rows()).toHaveLength(1);

    // Switched to OIDC on the authority table. The derived row has to go, or
    // the plugin keeps answering for a provider that is no longer one.
    await syncSamlProvider(wb.appPool, saml({ kind: "oidc" }), BASE);
    expect(await rows()).toHaveLength(0);
  });

  it("removes the row when the configuration becomes incomplete", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);

    // Migration 0096's constraint stops this reaching the database, so this is
    // the belt to that brace: a half-configured provider answers nothing
    // rather than answering with a missing certificate.
    await syncSamlProvider(
      wb.appPool,
      saml({ samlCertificate: undefined }),
      BASE,
    );
    expect(await rows()).toHaveLength(0);
  });
});

describe("syncing everything at boot", () => {
  it("removes a row whose authority disappeared while nothing was running", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);
    await syncSamlProvider(
      wb.appPool,
      saml({ id: "33333333-3333-4333-8333-333333333333", providerId: "sso-entra-abcd1234" }),
      BASE,
    );
    expect(await rows()).toHaveLength(2);

    // Boot with only one of them still configured. This is the drift that
    // matters: the product considers Entra gone, and without this the plugin
    // would still sign somebody in through it.
    const kept = await syncAllSamlProviders(wb.appPool, [saml()], BASE);

    expect(kept).toBe(1);
    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]?.provider_id).toBe("sso-okta-abcd1234");
  });

  it("leaves nothing behind when every provider is gone", async () => {
    const wb = await workerDb();
    await syncSamlProvider(wb.appPool, saml(), BASE);

    expect(await syncAllSamlProviders(wb.appPool, [], BASE)).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("ignores OIDC providers rather than deriving rows for them", async () => {
    const wb = await workerDb();

    const written = await syncAllSamlProviders(
      wb.appPool,
      [saml({ kind: "oidc" })],
      BASE,
    );

    expect(written).toBe(0);
    expect(await rows()).toHaveLength(0);
  });
});
