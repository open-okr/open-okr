import { withInstanceAdmin } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorisationServerMetadata,
  challengeHeader,
  DISCOVERY_ROUTES,
  discoveryDocumentAt,
  OAUTH_PATHS,
  openIdConfiguration,
  protectedResourceMetadata,
} from "../src/api/oauth/discovery.ts";
import {
  parseClientMetadata,
  redirectRegistrable,
  registerClient,
  registrationResponse,
} from "../src/api/oauth/registration.ts";

/**
 * What a client reads before it knows anything, and how it registers itself
 * (RFC 8414, RFC 9728, RFC 7591, P5-T08b).
 *
 * The acceptance criterion is the last test: a client told only the instance URL
 * reads the documents, registers, and has everything it needs to start the
 * authorisation flow, with nobody having configured anything.
 */

const ISSUER = "https://okr.example";

describe("the discovery documents", () => {
  it("names the token endpoint identically in all three", () => {
    // Three documents from one builder, so they cannot disagree about where an
    // endpoint lives. That is the only reason there is one builder.
    const expected = `${ISSUER}${OAUTH_PATHS.token}`;
    expect(authorisationServerMetadata(ISSUER).token_endpoint).toBe(expected);
    expect(openIdConfiguration(ISSUER).token_endpoint).toBe(expected);
  });

  it("points the protected resource at this instance as its authorisation server", () => {
    const document = protectedResourceMetadata(ISSUER);
    expect(document.resource).toBe(`${ISSUER}${OAUTH_PATHS.resource}`);
    expect(document.authorization_servers).toEqual([ISSUER]);
  });

  it("advertises only S256, because only S256 is accepted", () => {
    // Advertising `plain` and refusing it would be a downgrade an attacker
    // could ask for and a support question for everybody else.
    const document = authorisationServerMetadata(ISSUER);
    expect(document.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("advertises only the two grant types this server has", () => {
    const document = authorisationServerMetadata(ISSUER);
    expect(document.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    // Every client here is public: an agent on a laptop can hold no secret an
    // attacker could not also hold.
    expect(document.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("serves each document at its plain and its transport-suffixed path", () => {
    // RFC 9728 puts the resource path after the well-known segment. Clients
    // differ on which they try, and serving one is how a connection fails with
    // nothing in a log to explain it.
    for (const path of Object.keys(DISCOVERY_ROUTES)) {
      expect(discoveryDocumentAt(path, ISSUER), path).not.toBeNull();
    }
    expect(
      discoveryDocumentAt(
        "/.well-known/oauth-protected-resource/api/mcp",
        ISSUER,
      ),
    ).toEqual(
      discoveryDocumentAt("/.well-known/oauth-protected-resource", ISSUER),
    );
  });

  it("answers nothing at a path it does not serve", () => {
    expect(discoveryDocumentAt("/.well-known/security.txt", ISSUER)).toBeNull();
  });

  it("strips a trailing slash from the issuer exactly once", () => {
    expect(authorisationServerMetadata("https://okr.example/").issuer).toBe(
      ISSUER,
    );
    expect(authorisationServerMetadata("https://okr.example///").issuer).toBe(
      ISSUER,
    );
  });
});

describe("the challenge on an unauthorised answer", () => {
  it("points at the resource metadata, so a 401 is the first step of the flow", () => {
    const header = challengeHeader(ISSUER);
    expect(header).toContain("Bearer");
    expect(header).toContain(
      `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
    );
  });

  it("carries an error and its description when there is one", () => {
    const header = challengeHeader(ISSUER, {
      error: "invalid_token",
      description: "That token has expired.",
    });
    expect(header).toContain(`error="invalid_token"`);
    expect(header).toContain(`error_description="That token has expired."`);
  });

  it("never lets a quote out of a description and break the header", () => {
    const header = challengeHeader(ISSUER, {
      description: 'a "quoted" thing',
    });
    // The description sits between one opening and one closing quote, with
    // nothing inside it that could close the value early.
    expect(header).toContain('error_description="a quoted thing"');
    // Three parameters carry a quoted value here, so six quotes and no more:
    // a stray one would end a value and turn the rest into new parameters.
    expect(header.match(/"/g)?.length).toBe(6);
  });
});

describe("which addresses may be registered", () => {
  it("refuses a scheme that executes or reads the disk", () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "vbscript:msgbox",
    ]) {
      expect(redirectRegistrable(uri, true), uri).not.toBeNull();
    }
  });

  it("allows a custom scheme only when it names a callback path", () => {
    // How a desktop agent receives its answer from the operating system.
    expect(redirectRegistrable("myagent://host/callback", false)).toBeNull();
    // Claiming the whole scheme would mean claiming every address in it.
    expect(redirectRegistrable("myagent://host", false)).not.toBeNull();
    expect(redirectRegistrable("myagent://host/", false)).not.toBeNull();
  });

  it("allows plain HTTP only to loopback", () => {
    expect(redirectRegistrable("http://127.0.0.1:7777/cb", true)).toBeNull();
    expect(redirectRegistrable("http://localhost:7777/cb", true)).toBeNull();
    expect(redirectRegistrable("http://agent.example/cb", true)).not.toBeNull();
  });

  it("allows any HTTPS address", () => {
    expect(redirectRegistrable("https://agent.example/cb", true)).toBeNull();
  });

  it("refuses something that is not an address", () => {
    expect(redirectRegistrable("not an address", true)).not.toBeNull();
  });
});

describe("reading a client metadata document", () => {
  it("takes the name and the addresses, and names an unnamed client", () => {
    const parsed = parseClientMetadata(
      JSON.stringify({ redirect_uris: ["https://agent.example/cb"] }),
    );
    expect(parsed?.clientName).toBe("An unnamed agent");
    expect(parsed?.redirectUris).toEqual(["https://agent.example/cb"]);
  });

  it("refuses a document with nothing usable in it", () => {
    // Untrusted throughout: every one of these is something a stranger's
    // server is free to return.
    for (const body of [
      "not json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ redirect_uris: [] }),
      JSON.stringify({ redirect_uris: "https://agent.example/cb" }),
      JSON.stringify({ redirect_uris: [42, null] }),
    ]) {
      expect(parseClientMetadata(body), body).toBeNull();
    }
  });
});

describe("registering", () => {
  const register = async (
    over: Partial<Parameters<typeof registerClient>[1]> = {},
  ) => {
    const wb = await workerDb();
    return withInstanceAdmin(drizzle(wb.appPool), (tx) =>
      registerClient(tx, {
        clientName: "An agent",
        redirectUris: ["https://agent.example/cb"],
        requireTransportSecurity: true,
        now: new Date(),
        ...over,
      }),
    );
  };

  beforeEach(async () => {
    const wb = await workerDb();
    await wb.truncateAllTables();
  });

  afterAll(async () => {
    const wb = await workerDb();
    await wb.close();
  });

  it("issues an identifier of its own, never one the client chose", async () => {
    const outcome = await register();
    expect(outcome.kind).toBe("registered");
    if (outcome.kind !== "registered") {
      return;
    }
    // A client that picked its own could claim another's, and every grant is
    // keyed on this.
    expect(outcome.client.clientId).toMatch(/^okr_client_[0-9a-f]{32}$/);
    expect(outcome.client.source).toBe("registered");
  });

  it("hands back no client secret at all", async () => {
    const outcome = await register();
    if (outcome.kind !== "registered") {
      throw new Error("expected a registration");
    }
    const response = registrationResponse(outcome.client);
    // Emitting an empty one would be worse than omitting it: a client that
    // finds the field will try to use it.
    expect("client_secret" in response).toBe(false);
    expect(response.token_endpoint_auth_method).toBe("none");
  });

  it("refuses a dangerous redirect scheme", async () => {
    const outcome = await register({
      redirectUris: ["javascript:alert(1)"],
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.error).toBe("invalid_redirect_uri");
    }
  });

  it("refuses a client with no name or no address", async () => {
    expect((await register({ clientName: "  " })).kind).toBe("refused");
    expect((await register({ redirectUris: [] })).kind).toBe("refused");
  });

  it("never issues the same identifier twice", async () => {
    const first = await register();
    const second = await register();
    if (first.kind !== "registered" || second.kind !== "registered") {
      throw new Error("expected two registrations");
    }
    expect(first.client.clientId).not.toBe(second.client.clientId);
  });

  it("acceptance: a client told only the instance URL can reach the flow", async () => {
    // Everything it needs, from the documents alone.
    const metadata = authorisationServerMetadata(ISSUER);
    expect(metadata.registration_endpoint).toBe(
      `${ISSUER}${OAUTH_PATHS.register}`,
    );

    const outcome = await register({
      redirectUris: ["https://agent.example/cb"],
    });
    if (outcome.kind !== "registered") {
      throw new Error("expected a registration");
    }
    const response = registrationResponse(outcome.client);

    // And now it holds an identifier the authorise endpoint will accept, with
    // nobody having configured anything.
    expect(response.client_id).toBe(outcome.client.clientId);
    expect(metadata.authorization_endpoint).toBe(
      `${ISSUER}${OAUTH_PATHS.authorize}`,
    );
  });
});
