import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { workerDb } from "@openokr/test-support/db";
import * as saml from "samlify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { syncSamlProvider } from "../src/auth/saml-sync.ts";
import type { SSOProviderConfig } from "../src/auth/sso.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * What a SAML assertion has to survive to sign somebody in (P8-T07c-a).
 *
 * **The first version of this file proved nothing, and that is worth writing
 * down.** Every refusal passed, and so would a plugin that accepted
 * everything: a valid assertion was being refused too, at an earlier gate, so
 * "it was refused" said only that nothing ever got in. The happy path below is
 * therefore not a formality. It is what makes the four refusals mean anything
 * at all, and no refusal should ever be added here without it passing first.
 *
 * Driving a real assertion all the way through found three defects that every
 * layer above them answered correctly:
 *
 * 1. `samlConfig.issuer` is the *service provider's* entity id, not the
 *    identity provider's. Written the other way round, the plugin refused the
 *    whole configuration.
 * 2. Just-in-time provisioning was refused on any invitation-only instance,
 *    which is every instance after its first account. A configured provider
 *    now vouches for its people, the way a directory token does.
 * 3. Better Auth hands the hook a route template with the id in `params`, so
 *    matching on the path alone matched nothing.
 *
 * **What these tests hold is the wiring, not the library.** The refusals are
 * `samlify`'s, and testing somebody else's library is not the job. What is
 * ours is which certificate reaches it and which audience: get either wrong
 * and either everything is accepted or nothing is. The case that carries the
 * most weight is the one signed by a stranger's key, because it is the only
 * one that fails if the certificate this product stored is not the one the
 * plugin verifies against.
 *
 * **Each bad assertion is wrong in exactly one way** and is otherwise a
 * genuinely signed document from a real identity provider.
 */

const IDP_ENTITY = "https://idp.example/entity";
const PROVIDER = "sso-fixture-idp";
const OWNER = "saml-owner";
const BASE = "http://localhost:3000";
const ACS = `${BASE}/api/auth/sso/saml2/sp/acs/${PROVIDER}`;

const FIXTURES = join(import.meta.dirname, "fixtures", "saml");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/**
 * Schema validation is skipped, and the tests are written knowing it.
 *
 * `samlify` requires a validator and ships none. The defences these tests are
 * about, the signature and the audience, are not the schema's job, so a
 * permissive validator does not weaken them. It does mean this file says
 * nothing about malformed XML, which is stated rather than implied.
 */
saml.setSchemaValidator({ validate: async () => "skipped" });

let workspaceId: string;
let auth: ReturnType<typeof createAuth>;

const certificate = read("idp-cert.pem");

const connection = (): SSOProviderConfig =>
  ({
    kind: "saml",
    id: "44444444-4444-4444-8444-444444444444",
    providerId: PROVIDER,
    displayName: "Fixture IdP",
    workspaceId,
    clientId: "unused",
    clientSecret: "unused",
    scopes: [],
    emailDomains: ["acme.example"],
    enforce: false,
    samlEntryPoint: "https://idp.example/sso",
    samlIssuer: IDP_ENTITY,
    samlCertificate: certificate,
    samlWantAssertionsSigned: true,
  }) as SSOProviderConfig;

const identityProvider = (key: string, cert: string) =>
  saml.IdentityProvider({
    entityID: IDP_ENTITY,
    privateKey: read(key),
    signingCert: read(cert),
    isAssertionEncrypted: false,
    singleSignOnService: [
      {
        Binding: saml.Constants.namespace.binding.post,
        Location: "https://idp.example/sso",
      },
    ],
  });

/** The audience an issued assertion carries is this entity id. */
const serviceProvider = (entityID: string) =>
  saml.ServiceProvider({
    entityID,
    // Without this `samlify` signs the response and not the assertion, and the
    // plugin refuses it: the stored configuration asks for a signed assertion.
    wantAssertionsSigned: true,
    assertionConsumerService: [
      { Binding: saml.Constants.namespace.binding.post, Location: ACS },
    ],
  });

beforeAll(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from sso_providers");
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict (id) do nothing",
    [OWNER, "SAML Owner", "saml-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "SAML Workspace",
    })
  ).workspaceId;

  await syncSamlProvider(wb.appPool, connection(), BASE);

  auth = createAuth({
    pool: wb.appPool,
    secret: "a-test-secret-of-sufficient-length-for-signing",
    baseUrl: BASE,
    rateLimit: { enabled: false },
    ssoProviders: [connection()],
  });
}, 60_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/**
 * One whole sign-in, from pressing the button to landing.
 *
 * **Service-provider initiated, because that is what a person does.** An
 * unsolicited assertion is refused before anything else is looked at, so a
 * test that posted one would refuse every case for the same uninteresting
 * reason, which is precisely how the first version of this file came to prove
 * nothing.
 */
async function signIn(options: {
  key?: string;
  cert?: string;
  audience?: string;
  tamper?: (xml: string) => string;
}): Promise<Response> {
  const start = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: PROVIDER, callbackURL: "/" }),
    }),
  );
  expect(start.status).toBe(200);

  const relayState = start.headers.get("set-cookie") ?? "";
  const request = new URL((await start.json()).url).searchParams.get(
    "SAMLRequest",
  );
  const requestXml = inflateRawSync(
    Buffer.from(String(request), "base64"),
  ).toString("utf8");
  const requestId = /ID="([^"]+)"/.exec(requestXml)?.[1] ?? "";
  expect(requestId).not.toBe("");

  const issued = await identityProvider(
    options.key ?? "idp-key.pem",
    options.cert ?? "idp-cert.pem",
  ).createLoginResponse(
    serviceProvider(options.audience ?? BASE),
    { extract: { request: { id: requestId } } } as never,
    "post",
    { email: "someone@acme.example" },
    undefined,
    false,
    undefined,
  );

  const xml = Buffer.from(issued.context, "base64").toString("utf8");
  const sent = options.tamper ? options.tamper(xml) : xml;

  return auth.handler(
    new Request(ACS, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(relayState ? { cookie: relayState } : {}),
      },
      body: new URLSearchParams({
        SAMLResponse: Buffer.from(sent, "utf8").toString("base64"),
      }).toString(),
    }),
  );
}

/** Whether the response signed somebody in. Anything else is a refusal. */
const signedIn = (response: Response): boolean =>
  (response.headers.get("set-cookie") ?? "").includes("session_token");

describe("a valid assertion", () => {
  it("signs somebody in, which is what makes the refusals below mean anything", async () => {
    const response = await signIn({});

    expect(signedIn(response)).toBe(true);
    expect(response.headers.get("location")).toBe(`${BASE}/`);
  });

  it("lands them in the workspace that configured the provider, and makes no second one", async () => {
    const wb = await workerDb();
    await signIn({});

    // P8-T07b's whole point, reached through the SAML path this time. An
    // arrival that got a workspace of their own would be the defect that row
    // was cut to fix, coming back through a different door.
    const { rows: member } = await wb.admin.query(
      `select m.workspace_id from workspace_members m
         join users u on u.id = m.user_id
        where u.email = 'someone@acme.example' and m.deleted_at is null`,
    );
    expect(member).toHaveLength(1);
    expect(member[0]?.workspace_id).toBe(workspaceId);

    const { rows: theirs } = await wb.admin.query(
      `select count(*)::int as n from workspaces w
        where w.deleted_at is null and w.name like '%someone%'`,
    );
    expect(theirs[0]?.n).toBe(0);
  });
});

describe("assertions that must be refused", () => {
  it("refuses one with the signature removed", async () => {
    const response = await signIn({
      tamper: (xml) => {
        const stripped = xml.replace(
          /<(ds:)?Signature[\s\S]*?<\/(ds:)?Signature>/,
          "",
        );
        expect(stripped).not.toContain("SignatureValue");
        return stripped;
      },
    });

    expect(signedIn(response)).toBe(false);
  });

  it("refuses one whose signature has been tampered with", async () => {
    const response = await signIn({
      tamper: (xml) => {
        // One character inside the signature, which is all it should take.
        const tampered = xml.replace(
          /(<(?:ds:)?SignatureValue>)(.)/,
          (_all, open: string, first: string) =>
            `${open}${first === "A" ? "B" : "A"}`,
        );
        expect(tampered).not.toBe(xml);
        return tampered;
      },
    });

    expect(signedIn(response)).toBe(false);
  });

  it("refuses one signed correctly by a key this workspace never trusted", async () => {
    // **The case that carries the most weight.** Structurally perfect, signed
    // by a real certificate, and not the certificate the workspace
    // configured. If the product wired the wrong field through to the plugin,
    // this is the one that lets somebody in.
    const response = await signIn({
      key: "stranger-key.pem",
      cert: "stranger-cert.pem",
    });

    expect(signedIn(response)).toBe(false);
  });

  it("refuses one addressed to a different audience", async () => {
    // Signed by the right key, wrong only in who it was for. An assertion
    // minted for another service provider must not be replayable here.
    const response = await signIn({
      audience: "https://someone-elses-instance.example",
    });

    expect(signedIn(response)).toBe(false);
  });
});

/**
 * **The condition window is not covered here, and this says so rather than
 * leaving a gap somebody finds later.**
 *
 * An expired assertion has to be signed correctly and carry a `NotOnOrAfter`
 * in the past, and `samlify` writes that window itself when it issues a
 * response: a `loginResponseTemplate` with hardcoded dates is overwritten.
 * Producing one means editing the XML after signing, which breaks the
 * signature, then re-signing, which means reimplementing the signing path this
 * suite exists to check.
 *
 * What holds meanwhile is that the window is `samlify`'s to enforce and this
 * product passes it nothing: no clock skew, no lifetime, no override. P8-T07c-b
 * carries an end-to-end pass against a real identity provider.
 */
