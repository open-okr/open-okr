import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpFlowyteamGateway } from "../src/drivers/flowyteam/http.ts";

/**
 * The FlowyTeam gateway against a local FlowyTeam stub
 * (docs/design/flowyteam-connect.md §3, §6 F5). A real HTTP server on the
 * loopback address, reached through the outbound guard with private
 * addresses allowed, the way a self-hosted instance beside its own FlowyTeam
 * would reach it.
 */

const TOKEN = "stub-export-token";
const VERSION = "catalogue-v1";

interface Seen {
  path: string;
  body: string;
  authorization: string | undefined;
  contentType: string | undefined;
}

let server: Server;
let baseUrl: string;
let seen: Seen[] = [];
let revokeStatus = 200;

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const body = await read(request);
    seen.push({
      path: request.url ?? "",
      body,
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
    });
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.url === "/oauth/token") {
      const form = new URLSearchParams(body);
      if (form.get("code") !== "good-code" || !form.get("code_verifier")) {
        return json(400, {
          error: "invalid_grant",
          error_description: "secret detail",
        });
      }
      return json(200, {
        access_token: TOKEN,
        token_type: "Bearer",
        scope: "flowyteam:export",
      });
    }
    if (request.url === "/api/export/v1/query") {
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        return json(401, { error: "unauthenticated" });
      }
      const query = JSON.parse(body) as { version: string; name: string };
      if (query.version !== VERSION) {
        return json(409, { error: "version_mismatch", version: "other" });
      }
      return json(200, {
        rows: [{ id: 42, company_name: "Northwind", status: "active" }],
        cursor: null,
      });
    }
    if (request.url === "/oauth/revoke") {
      return json(revokeStatus, {});
    }
    return json(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  revokeStatus = 200;
});

const gateway = () => createHttpFlowyteamGateway({ allowPrivate: true });

describe("the token exchange", () => {
  it("posts the code and the PKCE verifier and returns the token", async () => {
    const answer = await gateway().exchangeCode({
      baseUrl,
      clientId: "https://okr.example.test/api/imports/flowyteam/client",
      code: "good-code",
      codeVerifier: "verifier",
      redirectUri: "https://okr.example.test/admin/imports/flowyteam/callback",
    });
    expect(answer).toEqual({
      ok: true,
      value: { accessToken: TOKEN, scope: "flowyteam:export" },
    });
    const form = new URLSearchParams(seen[0]?.body);
    expect(seen[0]?.contentType).toBe("application/x-www-form-urlencoded");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("verifier");
    // A public client sends no secret at all.
    expect(form.has("client_secret")).toBe(false);
  });

  it("reports a refused code by FlowyTeam's error code, never its description", async () => {
    const answer = await gateway().exchangeCode({
      baseUrl,
      clientId: "client",
      clientSecret: "s3cret",
      code: "bad-code",
      codeVerifier: "verifier",
      redirectUri: "https://okr.example.test/cb",
    });
    expect(answer).toMatchObject({
      ok: false,
      failure: "refused",
      status: 400,
    });
    if (!answer.ok) {
      expect(answer.detail).toContain("invalid_grant");
      expect(answer.detail).not.toContain("secret detail");
    }
    expect(new URLSearchParams(seen[0]?.body).get("client_secret")).toBe(
      "s3cret",
    );
  });
});

describe("the company read", () => {
  it("asks for companies.byId with the catalogue version and the bearer token", async () => {
    const answer = await gateway().readCompany({
      baseUrl,
      accessToken: TOKEN,
      version: VERSION,
    });
    expect(answer).toEqual({
      ok: true,
      value: { companyId: "42", companyName: "Northwind" },
    });
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({
      version: VERSION,
      name: "companies.byId",
      values: [],
      cursor: null,
    });
  });

  it("names a 409 as a version mismatch", async () => {
    const answer = await gateway().readCompany({
      baseUrl,
      accessToken: TOKEN,
      version: "stale",
    });
    expect(answer).toMatchObject({ ok: false, failure: "version_mismatch" });
  });

  it("names a refused token as unauthorised, without the token in the detail", async () => {
    const answer = await gateway().readCompany({
      baseUrl,
      accessToken: "wrong-token",
      version: VERSION,
    });
    expect(answer).toMatchObject({ ok: false, failure: "unauthorised" });
    if (!answer.ok) {
      expect(answer.detail).not.toContain("wrong-token");
    }
  });
});

describe("revocation", () => {
  it("posts the token to the RFC 7009 endpoint", async () => {
    const answer = await gateway().revoke({
      baseUrl,
      clientId: "client",
      accessToken: TOKEN,
    });
    expect(answer).toEqual({ ok: true, value: null });
    expect(seen[0]?.path).toBe("/oauth/revoke");
    expect(new URLSearchParams(seen[0]?.body).get("token")).toBe(TOKEN);
  });

  it("treats a 5xx as unreachable, so the relay retries", async () => {
    revokeStatus = 503;
    const answer = await gateway().revoke({
      baseUrl,
      clientId: "client",
      accessToken: TOKEN,
    });
    expect(answer).toMatchObject({ ok: false, failure: "unreachable" });
  });
});

describe("the outbound guard", () => {
  it("refuses a private FlowyTeam address unless the deployment allows one", async () => {
    const answer = await createHttpFlowyteamGateway().readCompany({
      baseUrl,
      accessToken: TOKEN,
      version: VERSION,
    });
    expect(answer).toMatchObject({ ok: false, failure: "unreachable" });
    expect(seen).toHaveLength(0);
  });
});
