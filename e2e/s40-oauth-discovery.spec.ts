/**
 * Discovery and dynamic registration (RFC 8414, RFC 9728, RFC 7591, P5-T08b).
 *
 * Acceptance criterion:
 *   Given a client that knows only the instance URL, when it reads the
 *   discovery documents and registers itself, then it can complete the
 *   authorisation flow without an administrator having entered anything.
 *
 * This is a spec rather than a unit test because the whole claim is about
 * unauthenticated HTTP. The documents have to be reachable with no cookie, at
 * the paths clients actually try, with preflight answered, and the registration
 * endpoint has to accept a POST from a stranger. Every one of those lives in the
 * transport, and the proxy's session gate is exactly the thing that broke this
 * shape once before: before P5-T07a every inbound channel webhook was answered
 * with a redirect to the sign-in page.
 *
 * What each document *says* is proved against the builders in
 * `packages/core/test/oauth-discovery.test.ts`.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

let api: APIRequestContext;
let base: string;

test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL ?? "";
  // No cookies at all. A client reading these has never signed in and never
  // will: it is software, not a person.
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
});

const DOCUMENTS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/api/mcp",
  "/.well-known/openid-configuration",
  "/.well-known/openid-configuration/api/mcp",
];

test("every discovery document answers without a session", async () => {
  for (const path of DOCUMENTS) {
    const response = await api.get(path);
    expect(response.status(), path).toBe(200);
    // A redirect to /sign-in would be status 200 with HTML in it, which is what
    // an HTTP client reads as success and a person reads as a mystery.
    expect(response.headers()["content-type"], path).toContain(
      "application/json",
    );
  }
});

test("the metadata names endpoints on this instance", async () => {
  const response = await api.get("/.well-known/oauth-authorization-server");
  const document = (await response.json()) as Record<string, string>;

  expect(document.issuer).toBe(base.replace(/\/+$/, ""));
  expect(document.token_endpoint).toBe(`${document.issuer}/api/mcp/token`);
  expect(document.registration_endpoint).toBe(
    `${document.issuer}/api/mcp/register`,
  );
  expect(document.authorization_endpoint).toBe(
    `${document.issuer}/oauth/authorize`,
  );
});

test("preflight is answered, because several runtimes read these from a browser", async () => {
  const response = await api.fetch("/.well-known/openid-configuration", {
    method: "OPTIONS",
  });
  expect(response.status()).toBe(204);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
});

test("a path that serves nothing is a 404, not a sign-in page", async () => {
  const response = await api.get("/.well-known/not-a-document");
  expect(response.status()).toBe(404);
});

test("a stranger can register, and is issued an identifier (acceptance)", async () => {
  const response = await api.post("/api/mcp/register", {
    data: {
      client_name: "An agent nobody has heard of",
      redirect_uris: ["https://agent.example/callback"],
    },
  });

  expect(response.status()).toBe(201);
  const registered = (await response.json()) as Record<string, unknown>;

  expect(String(registered.client_id)).toMatch(/^okr_client_[0-9a-f]{32}$/);
  expect(registered.client_name).toBe("An agent nobody has heard of");
  // Every client here is public, so there is no secret and the field is absent
  // rather than empty: a client that finds it will try to use it.
  expect("client_secret" in registered).toBe(false);
  expect(registered.token_endpoint_auth_method).toBe("none");
});

test("a dangerous redirect is refused with the code the specification defines", async () => {
  const response = await api.post("/api/mcp/register", {
    data: {
      client_name: "A hostile agent",
      redirect_uris: ["javascript:alert(1)"],
    },
  });

  expect(response.status()).toBe(400);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.error).toBe("invalid_redirect_uri");
});

test("a client document at a private address is refused, and says so", async () => {
  // The request-forgery case: a URL a stranger chose, pointed at the address
  // that returns credentials on most hosting.
  const response = await api.post("/api/mcp/register", {
    data: {
      client_name: "A curious agent",
      client_uri: "http://169.254.169.254/latest/meta-data/",
    },
  });

  expect(response.status()).toBe(400);
  const body = (await response.json()) as Record<string, string>;
  expect(body.error).toBe("invalid_client_metadata");
  expect(body.error_description).toContain("private or reserved");
});

test("the token endpoint is reachable without a session and refuses politely", async () => {
  // A client redeeming a code has no session by definition: getting one is the
  // point of the exchange.
  const response = await api.post("/api/mcp/token", {
    form: { grant_type: "authorization_code" },
  });

  expect(response.status()).toBe(400);
  const body = (await response.json()) as Record<string, string>;
  expect(body.error).toBe("invalid_request");
  // RFC 6749 §5.1: a token response is never cached, anywhere, by anything.
  expect(response.headers()["cache-control"]).toContain("no-store");
});
