import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { syncAllSamlProviders } from "../src/auth/saml-sync.ts";
import {
  createSSOConnection,
  loadSSOConnections,
  type SSOProviderConfig,
  samlServiceProviderUrls,
} from "../src/auth/sso.ts";
import {
  followSSOProviders,
  ssoConfigurationStamp,
  trackSSOProviders,
} from "../src/auth/sso-refresh.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import {
  generateSigningPairs,
  type SigningPairs,
} from "./saml-fixture-keys.ts";

/**
 * A connection saved while the process runs is used by the next sign-in
 * (completeness review L-15).
 *
 * Better Auth reads its plugins once, when an instance is built, and the web
 * process built one instance for its whole life. So a provider an
 * administrator added reached nobody until a restart, and one they removed
 * went on signing people in until then.
 *
 * **Nothing here builds an instance by hand after the first line.** The
 * sign-ins go through `followSSOProviders`, which is what the web process
 * serves every authentication request with, and every change is made to the
 * table the way an administrator's save makes it. A test that rebuilt the
 * instance itself would prove the plugin works, which was never in question.
 *
 * The identity provider is served from this process, so the token exchange is
 * real and the test can see which client id and which endpoint it was asked
 * with.
 */

const BASE = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const OWNER = "sso-restart-owner";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

/** What the identity provider was asked, in order. */
const idp = {
  server: undefined as Server | undefined,
  url: "",
  tokenRequests: [] as { path: string; clientId: string }[],
};

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** The client id a token request carried, in its body or its basic header. */
const clientIdOf = (form: URLSearchParams, authorization?: string) => {
  const fromBody = form.get("client_id");
  if (fromBody) {
    return fromBody;
  }
  const encoded = authorization?.replace(/^Basic /, "") ?? "";
  return decodeURIComponent(
    Buffer.from(encoded, "base64").toString("utf8").split(":")[0] ?? "",
  );
};

const startIdp = async () => {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const path = request.url?.split("?")[0] ?? "";
      if (path.endsWith("/token")) {
        idp.tokenRequests.push({
          path,
          clientId: clientIdOf(
            new URLSearchParams(body),
            request.headers.authorization,
          ),
        });
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "idp-access",
            token_type: "Bearer",
            expires_in: 3600,
            // Not verified: this provider has no discovery document, so
            // Better Auth decodes it for the profile only.
            id_token: `${base64url({ alg: "none" })}.${base64url({
              sub: "idp-subject-1",
              email: "arrival@acme.example",
              email_verified: true,
              name: "An Arrival",
            })}.c2lnbmF0dXJl`,
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
  });
  idp.server = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  idp.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

let workspaceId: string;
let keys: SigningPairs;

beforeAll(async () => {
  keys = generateSigningPairs();
  await startIdp();
}, 60_000);

afterAll(async () => {
  keys?.cleanUp();
  await new Promise((resolve) => idp.server?.close(resolve));
  const wb = await workerDb();
  await wb.close();
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  idp.tokenRequests = [];
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Restart Owner", "owner@acme.example"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "No Restart",
    })
  ).workspaceId;
});

/**
 * What the web process does, minus the framework glue: read the providers,
 * bring the SAML plugin's rows into line, and build an instance around them.
 */
const serveLikeTheWebProcess = async () => {
  const wb = await workerDb();
  const builds: (readonly SSOProviderConfig[])[] = [];
  const tracker = trackSSOProviders({
    pool: wb.appPool,
    load: async () => {
      const providers = await loadSSOConnections(wb.appPool, ring);
      await syncAllSamlProviders(wb.appPool, providers, BASE);
      return providers;
    },
    // Every call reads the stamp. The clock is the subject of its own tests
    // below; here the question is what a reading does.
    maxAgeMs: 0,
  });
  const auth = followSSOProviders(tracker, (providers) => {
    builds.push(providers);
    return createAuth({
      pool: wb.appPool,
      secret: SECRET,
      baseUrl: BASE,
      keyRing: () => ring,
      rateLimit: { enabled: false },
      ssoProviders: providers,
    });
  });
  // As the auth route does: every request asks for the current instance.
  const handle = async (request: Request) =>
    (await auth.current()).handler(request);
  return { handle, builds };
};

type Handle = (request: Request) => Promise<Response>;

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .join("; ");

const startSignIn = (handle: Handle, provider: string) =>
  handle(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, callbackURL: "/" }),
    }),
  );

/** Signs in through the provider. Returns where it was sent, and the cookie. */
const signInThrough = async (handle: Handle, provider: string) => {
  const start = await startSignIn(handle, provider);
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";
  const callback = await handle(
    new Request(
      `${BASE}/api/auth/callback/${provider}?code=a-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieFrom(start) } },
    ),
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).not.toContain("error");
  return { authorizeUrl: new URL(url), cookie: cookieFrom(callback) };
};

const sessionUser = async (handle: Handle, cookie: string) => {
  const response = await handle(
    new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } }),
  );
  const body = (await response.json()) as { user?: { email: string } } | null;
  return body?.user?.email ?? null;
};

const addOidcConnection = async () => {
  const wb = await workerDb();
  return createSSOConnection(
    wb.appPool,
    workspaceId,
    ring,
    {
      kind: "oidc",
      providerId: "acme",
      displayName: "Sign in with Acme",
      clientId: "client-one",
      clientSecret: "client-secret",
      authorizationUrl: `${idp.url}/authorize`,
      tokenUrl: `${idp.url}/token`,
      emailDomains: "acme.example",
    },
    BASE,
  );
};

/** An administrator's change, made to the table the screen writes. */
const changeConnection = async (assignments: string, values: unknown[]) => {
  const wb = await workerDb();
  await wb.admin.query(
    `update sso_connections set ${assignments}, updated_at = now()
      where workspace_id = $1 and provider_id = 'acme'`,
    [workspaceId, ...values],
  );
};

describe("a connection added while the process runs", () => {
  it("signs somebody in through it on the next attempt", async () => {
    const { handle } = await serveLikeTheWebProcess();

    // Serving already, with nothing configured.
    const before = await startSignIn(handle, "sso-acme-anything");
    expect(before.status).toBe(404);

    const { providerId } = await addOidcConnection();
    const { cookie } = await signInThrough(handle, providerId);

    expect(await sessionUser(handle, cookie)).toBe("arrival@acme.example");
  });

  it("lands them in the workspace that configured it", async () => {
    // The workspace a provider belongs to is read when the instance is built,
    // so this is the half that proves the rebuild carries it and not only the
    // plugin's own list.
    const { handle } = await serveLikeTheWebProcess();
    await startSignIn(handle, "warm-up");

    const { providerId } = await addOidcConnection();
    await signInThrough(handle, providerId);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ workspace_id: string }>(
      `select m.workspace_id from workspace_members m
         join users u on u.id = m.user_id
        where u.email = 'arrival@acme.example'
          and m.deleted_at is null`,
    );
    expect(rows.map((row) => row.workspace_id)).toEqual([workspaceId]);
  });
});

describe("a connection changed while the process runs", () => {
  it("uses the new client id on the next sign-in", async () => {
    const { handle } = await serveLikeTheWebProcess();
    const { providerId } = await addOidcConnection();
    const first = await signInThrough(handle, providerId);
    expect(first.authorizeUrl.searchParams.get("client_id")).toBe("client-one");

    await changeConnection("client_id = $2", ["client-two"]);
    const second = await signInThrough(handle, providerId);

    expect(second.authorizeUrl.searchParams.get("client_id")).toBe(
      "client-two",
    );
    expect(idp.tokenRequests.map((one) => one.clientId)).toEqual([
      "client-one",
      "client-two",
    ]);
  });

  it("sends the browser and the token exchange to the new endpoints", async () => {
    const { handle } = await serveLikeTheWebProcess();
    const { providerId } = await addOidcConnection();
    await signInThrough(handle, providerId);

    await changeConnection("authorization_url = $2, token_url = $3", [
      `${idp.url}/moved/authorize`,
      `${idp.url}/moved/token`,
    ]);
    const after = await signInThrough(handle, providerId);

    expect(after.authorizeUrl.pathname).toBe("/moved/authorize");
    expect(idp.tokenRequests.map((one) => one.path)).toEqual([
      "/token",
      "/moved/token",
    ]);
  });

  it("keeps everybody already signed in", async () => {
    const { handle, builds } = await serveLikeTheWebProcess();
    const { providerId } = await addOidcConnection();
    const { cookie } = await signInThrough(handle, providerId);
    const before = builds.length;

    await changeConnection("client_id = $2", ["client-two"]);
    await startSignIn(handle, providerId);

    // Rebuilt, and the session made by the instance before it still reads.
    expect(builds.length).toBe(before + 1);
    expect(await sessionUser(handle, cookie)).toBe("arrival@acme.example");
  });
});

describe("a connection removed while the process runs", () => {
  it("refuses the next sign-in through it", async () => {
    const { handle } = await serveLikeTheWebProcess();
    const { providerId } = await addOidcConnection();
    await signInThrough(handle, providerId);

    await changeConnection("deleted_at = now()", []);

    const refused = await startSignIn(handle, providerId);
    expect(refused.status).toBe(404);
  });

  it("refuses it when disabled rather than removed, too", async () => {
    const { handle } = await serveLikeTheWebProcess();
    const { providerId } = await addOidcConnection();
    await signInThrough(handle, providerId);

    await changeConnection("enabled = false", []);

    expect((await startSignIn(handle, providerId)).status).toBe(404);
  });
});

describe("SAML", () => {
  it("serves the first SAML provider's metadata document without a restart", async () => {
    // The SAML plugin reads its providers per request, which made SAML look
    // as if it needed no restart. It is only mounted when a SAML provider
    // exists at build time, though, so the first one on an instance had no
    // route to answer on.
    const { handle } = await serveLikeTheWebProcess();
    const unmounted = samlServiceProviderUrls(BASE, "sso-none-00000000");
    expect((await handle(new Request(unmounted.metadataUrl))).status).toBe(404);

    const wb = await workerDb();
    const created = await createSSOConnection(
      wb.appPool,
      workspaceId,
      ring,
      {
        kind: "saml",
        providerId: "fixture",
        displayName: "Fixture IdP",
        samlEntryPoint: "https://idp.example/sso",
        samlIssuer: "https://idp.example/entity",
        samlCertificate: keys.trusted.certificate,
        emailDomains: "acme.example",
      },
      BASE,
    );

    const urls = samlServiceProviderUrls(BASE, created.providerId);
    const response = await handle(new Request(urls.metadataUrl));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(urls.acsUrl);
  });
});

describe("how often the stamp is read", () => {
  const counting = async (maxAgeMs: number) => {
    const wb = await workerDb();
    let clock = 1_000;
    const load = vi.fn(() => loadSSOConnections(wb.appPool, ring));
    const tracker = trackSSOProviders({
      pool: wb.appPool,
      load,
      maxAgeMs,
      now: () => clock,
    });
    return {
      tracker,
      load,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it("trusts one reading for its whole age, then sees the change", async () => {
    // Another process saved the change, so nothing here was told about it.
    const { tracker, advance } = await counting(5_000);
    expect(await tracker.current()).toEqual([]);

    await addOidcConnection();
    advance(4_999);
    expect(await tracker.current()).toEqual([]);

    advance(1);
    expect((await tracker.current()).map((one) => one.clientId)).toEqual([
      "client-one",
    ]);
  });

  it("sees a change at once in the process that saved it", async () => {
    const { tracker } = await counting(60_000);
    await tracker.current();

    await addOidcConnection();
    tracker.expire();

    expect(await tracker.current()).toHaveLength(1);
  });

  it("reloads nothing, and rebuilds nothing, when nothing changed", async () => {
    await addOidcConnection();
    const { tracker, load, advance } = await counting(5_000);
    const builds = vi.fn((providers: readonly SSOProviderConfig[]) => ({
      providers,
    }));
    const auth = followSSOProviders(tracker, builds);

    const first = await auth.current();
    advance(60_000);
    const second = await auth.current();
    advance(60_000);
    const third = await auth.current();

    expect(load).toHaveBeenCalledTimes(1);
    expect(builds).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("reads once for callers who arrive together", async () => {
    const { tracker, load } = await counting(5_000);
    await addOidcConnection();

    const answers = await Promise.all(
      Array.from({ length: 8 }, () => tracker.current()),
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(answers).size).toBe(1);
  });

  it("keeps the providers it had when a reload fails, and tries again", async () => {
    const wb = await workerDb();
    await addOidcConnection();
    let clock = 0;
    let failing = false;
    const errors: unknown[] = [];
    const tracker = trackSSOProviders({
      pool: wb.appPool,
      load: async () => {
        if (failing) {
          throw new Error("the key ring is unreadable");
        }
        return loadSSOConnections(wb.appPool, ring);
      },
      maxAgeMs: 5_000,
      now: () => clock,
      onError: (error) => errors.push(error),
    });
    const held = await tracker.current();

    failing = true;
    await changeConnection("client_id = $2", ["client-two"]);
    clock += 5_000;
    // A sign-in is not failed by the check: it gets what was held.
    expect(await tracker.current()).toBe(held);
    expect(errors).toHaveLength(1);
    await expect(tracker.refresh()).rejects.toThrow("unreadable");

    failing = false;
    clock += 5_000;
    expect((await tracker.current()).map((one) => one.clientId)).toEqual([
      "client-two",
    ]);
  });
});

describe("the stamp", () => {
  it("moves on an addition, a change, a disabling and a removal, and on nothing else", async () => {
    const wb = await workerDb();
    const stamp = () => ssoConfigurationStamp(wb.appPool);

    const empty = await stamp();
    await addOidcConnection();
    const added = await stamp();
    expect(await stamp()).toBe(added);

    await changeConnection("scopes = $2", ["openid email"]);
    const changed = await stamp();
    expect(new Set([empty, added, changed]).size).toBe(3);

    // Disabled, and then enabled but removed: either way nothing enabled is
    // left, which is where it started.
    await changeConnection("enabled = false", []);
    expect(await stamp()).toBe(empty);
    await changeConnection("enabled = true", []);
    expect(await stamp()).not.toBe(empty);
    await changeConnection("deleted_at = now()", []);
    expect(await stamp()).toBe(empty);
  });
});
