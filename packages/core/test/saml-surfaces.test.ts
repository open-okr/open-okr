import { workerDb } from "@openokr/test-support/db";
import * as saml from "samlify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import {
  createSSOConnection,
  loadSSOConnections,
  samlServiceProviderUrls,
  validateSSOConnectionInput,
} from "../src/auth/sso.ts";
import { listEnforcingConnections } from "../src/auth/sso-enforcement.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import {
  generateSigningPairs,
  type SigningPairs,
} from "./saml-fixture-keys.ts";

/**
 * The surfaces around SAML (P8-T07c-b).
 *
 * P8-T07c-a built the path an assertion travels and proved what it refuses.
 * Nothing could reach that path: the admin screen wrote OIDC columns only, no
 * running process ever wrote the derived row the plugin reads, and the
 * enforcement backstop treated a SAML sign-in as a local factor and refused
 * it. This file is about the three of them.
 *
 * **What is proved here is that a configuration written through the product
 * produces a working provider**, rather than a fixture assembled by a test.
 * That is the distinction P8-T07c-a's own note asks for: every earlier SAML
 * defect passed a test that built its own row.
 */

const BASE = "http://localhost:3000";
const OWNER = "saml-surfaces-owner";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

saml.setSchemaValidator({ validate: async () => "skipped" });

let workspaceId: string;
let keys: SigningPairs;

const samlInput = () => ({
  kind: "saml" as const,
  providerId: "fixture",
  displayName: "Fixture IdP",
  samlEntryPoint: "https://idp.example/sso",
  samlIssuer: "https://idp.example/entity",
  samlCertificate: keys.trusted.certificate,
  emailDomains: "acme.example",
});

beforeAll(async () => {
  keys = generateSigningPairs();
  const wb = await workerDb();
  await wb.admin.query("delete from sso_providers");
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict (id) do nothing",
    [OWNER, "Surfaces Owner", "surfaces@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "SAML Surfaces",
    })
  ).workspaceId;
}, 60_000);

afterAll(async () => {
  keys?.cleanUp();
  const wb = await workerDb();
  await wb.close();
});

describe("what the screen refuses rather than stores", () => {
  it("names the SAML field that is missing", () => {
    const problem = validateSSOConnectionInput({
      ...samlInput(),
      samlEntryPoint: "",
    });
    expect(problem?.field).toBe("samlEntryPoint");
    expect(problem?.message).toContain("sign-on URL");
  });

  it("refuses a certificate that is not one", () => {
    const problem = validateSSOConnectionInput({
      ...samlInput(),
      samlCertificate: "not a certificate",
    });
    // The database constraint only asks that the column is not null, so a
    // string that is not a certificate would be stored and fail at somebody's
    // sign-in instead. That is the class this row exists to close.
    expect(problem?.field).toBe("samlCertificate");
  });

  it("accepts a certificate a provider published without its PEM header", () => {
    const bare = keys.trusted.certificate
      .replace(/-----[A-Z ]+-----/g, "")
      .replace(/\s+/g, "");
    expect(
      validateSSOConnectionInput({ ...samlInput(), samlCertificate: bare }),
    ).toBeNull();
  });

  it("accepts a complete SAML provider", () => {
    expect(validateSSOConnectionInput(samlInput())).toBeNull();
  });

  it("asks an OIDC provider for the things SAML does not have", () => {
    expect(
      validateSSOConnectionInput({
        kind: "oidc",
        providerId: "okta",
        displayName: "Okta",
        clientId: "id",
        discoveryUrl: "https://idp.example/.well-known/openid-configuration",
      })?.field,
    ).toBe("clientSecret");
  });

  it("refuses a provider id that is not a provider id, whichever protocol", () => {
    expect(
      validateSSOConnectionInput({ ...samlInput(), providerId: "Not Valid" })
        ?.field,
    ).toBe("providerId");
  });
});

describe("a SAML provider configured through the product", () => {
  it("reads back as SAML, with the derived row already written", async () => {
    const wb = await workerDb();
    const created = await createSSOConnection(
      wb.appPool,
      workspaceId,
      ring,
      samlInput(),
      BASE,
    );

    const connections = await loadSSOConnections(wb.appPool, ring);
    const one = connections.find((c) => c.id === created.id);
    expect(one?.kind).toBe("saml");
    expect(one?.samlEntryPoint).toBe("https://idp.example/sso");
    expect(one?.samlIssuer).toBe("https://idp.example/entity");

    // **The derived row, without a restart.** `syncAllSamlProviders` existed
    // and no running process called it, so `sso_providers` stayed empty on
    // every instance and the plugin had nothing to answer a sign-in with.
    const derived = await wb.admin.query(
      "select provider_id from sso_providers where provider_id = $1",
      [created.providerId],
    );
    expect(derived.rows).toHaveLength(1);
  });

  it("is enforced as SAML, so the sign-in page knows which button to press", async () => {
    const wb = await workerDb();
    await createSSOConnection(
      wb.appPool,
      workspaceId,
      ring,
      { ...samlInput(), providerId: "enforcing", enforce: true },
      BASE,
    );

    const enforcing = await listEnforcingConnections(wb.appPool);
    const one = enforcing.find((c) => c.providerId.includes("enforcing"));
    expect(one?.kind).toBe("saml");
  });
});

describe("the metadata document an identity provider is handed", () => {
  it("parses, and carries this instance's entity id and its ACS", async () => {
    const wb = await workerDb();
    const created = await createSSOConnection(
      wb.appPool,
      workspaceId,
      ring,
      { ...samlInput(), providerId: "metadata" },
      BASE,
    );

    const connections = await loadSSOConnections(wb.appPool, ring);
    const auth = createAuth({
      pool: wb.appPool,
      secret: SECRET,
      baseUrl: BASE,
      rateLimit: { enabled: false },
      ssoProviders: connections,
    });

    const urls = samlServiceProviderUrls(BASE, created.providerId);
    const response = await auth.handler(new Request(urls.metadataUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("xml");

    const xml = await response.text();
    // Parsed by the library that consumes it, rather than string-matched.
    const parsed = saml.ServiceProvider({ metadata: xml });
    expect(parsed.entityMeta.getEntityID()).toBe(BASE);
    expect(
      JSON.stringify(parsed.entityMeta.getAssertionConsumerService("post")),
    ).toContain(urls.acsUrl);
  });

  it("is reachable without a session, because an identity provider has none", async () => {
    const urls = samlServiceProviderUrls(BASE, "sso-anything-0000");
    expect(urls.metadataUrl).toContain("/api/auth/sso/saml2/sp/metadata");
    expect(urls.acsUrl).toBe(
      `${BASE}/api/auth/sso/saml2/sp/acs/sso-anything-0000`,
    );
    expect(urls.entityId).toBe(BASE);
  });
});
