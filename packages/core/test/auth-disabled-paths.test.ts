import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { AUTH_ENDPOINTS } from "../src/auth/endpoints.ts";

/**
 * The endpoints no screen uses answer 404 (docs/design/account-self-service.md
 * D26, plan 0.8.0 Y6), and the server calls that need two of them still run.
 *
 * Every request carries a live session cookie, so a 404 here is the path
 * being off rather than a missing session. The instance has an OIDC and a
 * SAML provider, so every plugin is mounted and the SSO plugin's paths are
 * really there to be refused.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const EMAIL = "endpoints@example.com";
const PASSWORD = "correct horse battery staple";

let auth: Auth;
let cookie: string;

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .join("; ");

const send = (
  method: string,
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        cookie,
        ...headers,
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    }),
  );

const OFF = AUTH_ENDPOINTS.filter((entry) => entry.served === "off");

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
    ssoProviders: [
      {
        providerId: "sso-oidc",
        clientId: "client",
        clientSecret: "secret",
        authorizationUrl: "http://127.0.0.1:9/authorize",
        tokenUrl: "http://127.0.0.1:9/token",
      },
      {
        kind: "saml",
        providerId: "sso-saml",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        clientId: "",
        clientSecret: "",
      },
    ],
  });
  cookie = "";
  const signUp = await send("POST", "/sign-up/email", {
    email: EMAIL,
    password: PASSWORD,
    name: "Endpoints",
  });
  expect(signUp.status).toBe(200);
  cookie = cookieFrom(signUp);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a path marked off", () => {
  it.each(OFF.map((entry) => [entry.path, entry.methods] as const))(
    "%s answers Better Auth's own 404",
    async (path, methods) => {
      for (const method of methods) {
        const response = await send(method, path);
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(await response.text()).toBe("Not Found");
      }
    },
  );

  it.each(
    OFF.map((entry) => [entry.path, entry.methods[0] as string] as const),
  )(
    "%s answers 404 with a trailing slash, in capitals and percent-encoded",
    async (path, method) => {
      const encoded = `/%${path.charCodeAt(1).toString(16).toUpperCase()}${path.slice(2)}`;
      for (const variant of [`${path}/`, path.toUpperCase(), encoded]) {
        const response = await send(method, variant);
        expect(response.status, `${method} ${variant}`).toBe(404);
      }
    },
  );

  it("does not run: a direct rename leaves the account's name alone", async () => {
    const response = await send("POST", "/update-user", { name: "Renamed" });
    expect(response.status).toBe(404);

    const wb = await workerDb();
    const { rows } = await wb.admin.query("select name from users");
    expect(rows).toEqual([{ name: "Endpoints" }]);
  });

  it("does not run: signing out everywhere leaves the session working", async () => {
    expect((await send("POST", "/revoke-sessions")).status).toBe(404);
    expect((await send("POST", "/revoke-other-sessions")).status).toBe(404);

    const session = await send("GET", "/get-session");
    const body = (await session.json()) as { user?: { email: string } } | null;
    expect(body?.user?.email).toBe(EMAIL);
  });

  it("does not run: unlinking leaves the password in place", async () => {
    const response = await send("POST", "/unlink-account", {
      providerId: "credential",
    });
    expect(response.status).toBe(404);

    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select provider_id from accounts where password is not null",
    );
    expect(rows).toEqual([{ provider_id: "credential" }]);
  });

  it("does not run: a signed-in person cannot register a provider", async () => {
    const response = await send("POST", "/sso/register", {
      providerId: "rogue",
      issuer: "https://idp.example.com",
      domain: "example.com",
    });
    expect(response.status).toBe(404);

    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from sso_providers",
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe("what stays on", () => {
  /**
   * A 404 with Better Auth's "Not Found", or with no body at all, is the
   * request never reaching a handler: off, or not routed. Anything else,
   * a refusal included, is the handler answering.
   */
  const reachedHandler = async (response: Response) =>
    !(
      response.status === 404 &&
      ["Not Found", ""].includes(await response.text())
    );

  const ON = AUTH_ENDPOINTS.filter((entry) => entry.served === "on");

  it.each(ON.map((entry) => [entry.path, entry.methods] as const))(
    "%s reaches its handler",
    async (path, methods) => {
      // Signed out and with an empty body, so no request here changes
      // anything: each handler refuses or answers, and either will do.
      const concrete = path.replace(/:[a-zA-Z]+/g, "x");
      for (const method of methods) {
        const response = await send(method, concrete, {}, { cookie: "" });
        expect(await reachedHandler(response), `${method} ${path}`).toBe(true);
      }
    },
  );

  it("still serves a signed-in screen what it reads", async () => {
    expect((await send("GET", "/get-session")).status).toBe(200);
    expect((await send("GET", "/passkey/list-user-passkeys")).status).toBe(200);
  });
});

describe("server calls behind a path that is off", () => {
  const headers = () => new Headers({ cookie });

  it("still verifies a password from server code", async () => {
    await expect(
      auth.api.verifyPassword({
        headers: headers(),
        body: { password: PASSWORD },
      }),
    ).resolves.toEqual({ status: true });
  });

  it("still reaches the change of email from server code", async () => {
    // Its handler runs and answers that the change is not enabled here.
    // Off over HTTP would have been a 404 before any handler.
    await expect(
      auth.api.changeEmail({
        headers: headers(),
        body: { newEmail: "moved@example.com" },
      }),
    ).rejects.toMatchObject({ body: { code: "CHANGE_EMAIL_DISABLED" } });
  });

  it("turns the change of email on from server code only, where mail can be sent (Y4)", async () => {
    const wb = await workerDb();
    const withMail = createAuth({
      pool: wb.appPool,
      secret: SECRET,
      baseUrl: BASE_URL,
      rateLimit: { enabled: false },
      canSendMail: true,
    });
    await expect(
      withMail.api.changeEmail({
        headers: headers(),
        body: { newEmail: "moved@example.com" },
      }),
    ).resolves.toEqual({ status: true });
    const response = await withMail.handler(
      new Request(`${BASE_URL}/api/auth/change-email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          cookie,
        },
        body: JSON.stringify({ newEmail: "elsewhere@example.com" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("still revokes a session from server code, as Security does", async () => {
    const second = cookieFrom(
      await send("POST", "/sign-in/email", {
        email: EMAIL,
        password: PASSWORD,
      }),
    );
    const other = await send("GET", "/get-session", {}, { cookie: second });
    const { session } = (await other.json()) as { session: { token: string } };

    await auth.api.revokeSession({
      headers: headers(),
      body: { token: session.token },
    });

    const after = await send("GET", "/get-session", {}, { cookie: second });
    expect(await after.json()).toBeNull();
  });

  it("refuses to register a provider even from server code", async () => {
    await expect(
      auth.api.registerSSOProvider({
        headers: headers(),
        body: {
          providerId: "rogue",
          issuer: "https://idp.example.com",
          domain: "example.com",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from sso_providers",
    );
    expect(rows[0]?.n).toBe(0);
  });
});
