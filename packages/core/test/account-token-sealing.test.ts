import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runDataChanges, sealAccountTokens } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  isSealedAccountToken,
  openAccountToken,
  rewrapAccountToken,
  sealAccountToken,
  withSealedAccountTokens,
} from "../src/auth/account-token-sealing.ts";
import { createAuth } from "../src/auth/auth.ts";
import {
  KeyRingError,
  newRootKey,
  parseKeyRing,
} from "../src/secrets/key-ring.ts";

/**
 * Identity-provider tokens sealed at rest (completeness review L-11).
 *
 * Better Auth kept the access, refresh and ID tokens an OIDC provider issued
 * on the `accounts` row in plain text. The first half of this file pins the
 * adapter wrapper against a stand-in adapter; the second drives a real sign-in
 * through a provider served from this process, against a real database, and
 * reads the stored row back.
 */

const ROOT = newRootKey();
const ring = parseKeyRing({ current: ROOT });

// The adapter surface is deliberately loose in the wrapper (see the note in
// session-hashing.ts), so the stand-in matches that shape.
// biome-ignore lint/suspicious/noExplicitAny: mirrors the adapter contract.
type SpyMethod = (query: any) => Promise<any>;

interface SpyAdapter {
  id: string;
  create: SpyMethod;
  findOne: SpyMethod;
  findMany: SpyMethod;
  update: SpyMethod;
  updateMany: SpyMethod;
  delete: SpyMethod;
  deleteMany: SpyMethod;
  count: SpyMethod;
  options: Record<string, unknown>;
  transaction?: unknown;
  [key: string]: unknown;
}

interface Query {
  model: string;
  data?: unknown;
  update?: unknown;
}

/** A stand-in adapter that records what it was asked and answers it. */
const spyAdapter = (answer: (method: string, query: Query) => unknown) => {
  const calls: { method: string; argument: unknown }[] = [];
  const record = (method: string) => (argument: Query) => {
    calls.push({ method, argument });
    return Promise.resolve(answer(method, argument));
  };
  const adapter: SpyAdapter = {
    id: "spy",
    create: vi.fn(record("create")),
    findOne: vi.fn(record("findOne")),
    findMany: vi.fn(record("findMany")),
    update: vi.fn(record("update")),
    updateMany: vi.fn(record("updateMany")),
    delete: vi.fn(record("delete")),
    deleteMany: vi.fn(record("deleteMany")),
    count: vi.fn(record("count")),
    options: {},
  };
  return { calls, adapter };
};

const echo = (method: string, query: Query) =>
  method === "create"
    ? query.data
    : method === "update"
      ? query.update
      : method === "updateMany"
        ? 1
        : null;

/** The data a recorded create was asked to store. */
const dataOf = (
  call: { argument: unknown } | undefined,
): Record<string, unknown> => {
  if (!call) {
    throw new Error("the adapter was not called");
  }
  return (call.argument as { data: Record<string, unknown> }).data;
};

const TOKENS = {
  accessToken: "provider-access-token",
  refreshToken: "provider-refresh-token",
  idToken: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhIn0.c2ln",
};

describe("sealing one token", () => {
  it("opens to what was sealed, and never looks like it", () => {
    const sealed = sealAccountToken(ring, "a-token");
    expect(isSealedAccountToken(sealed)).toBe(true);
    expect(sealed).not.toContain("a-token");
    expect(openAccountToken(ring, sealed)).toBe("a-token");
  });

  it("gives the same token a different value each time", () => {
    expect(sealAccountToken(ring, "same")).not.toBe(
      sealAccountToken(ring, "same"),
    );
  });

  it("hands back a value written before sealing as it is", () => {
    expect(openAccountToken(ring, "legacy-plain-token")).toBe(
      "legacy-plain-token",
    );
  });

  it("refuses to open under a key it was not sealed with", () => {
    const stranger = parseKeyRing({ current: newRootKey() });
    expect(() =>
      openAccountToken(stranger, sealAccountToken(ring, "a-token")),
    ).toThrow(KeyRingError);
  });

  it("re-wraps onto a new key without changing the token", () => {
    const next = newRootKey();
    const rotating = parseKeyRing({ current: next, previous: [ROOT] });
    const sealed = sealAccountToken(ring, "a-token");

    const moved = rewrapAccountToken(rotating, sealed);
    expect(moved).not.toBe(sealed);
    expect(openAccountToken(parseKeyRing({ current: next }), moved)).toBe(
      "a-token",
    );
    // Already current, so a second pass has nothing to do.
    expect(rewrapAccountToken(rotating, moved)).toBe(moved);
  });
});

describe("withSealedAccountTokens", () => {
  it("stores the account's three tokens sealed, and hands the caller them open", async () => {
    const { adapter, calls } = spyAdapter(echo);
    const wrapped = withSealedAccountTokens(adapter, () => ring);

    const created = await wrapped.create({
      model: "account",
      data: { id: "a1", userId: "u1", providerId: "okta", ...TOKENS },
    });

    const stored = dataOf(calls[0]);
    for (const field of ["accessToken", "refreshToken", "idToken"]) {
      expect(isSealedAccountToken(stored[field] as string)).toBe(true);
    }
    for (const token of Object.values(TOKENS)) {
      expect(JSON.stringify(calls)).not.toContain(token);
    }
    expect(created).toMatchObject(TOKENS);
  });

  it("seals on update and on a bulk update", async () => {
    const { adapter, calls } = spyAdapter(echo);
    const wrapped = withSealedAccountTokens(adapter, () => ring);
    const where = [{ field: "id", value: "a1" }];

    const updated = await wrapped.update({
      model: "account",
      where,
      update: { accessToken: "fresh-access" },
    });
    await wrapped.updateMany({
      model: "account",
      where,
      update: { refreshToken: "fresh-refresh" },
    });

    expect(JSON.stringify(calls)).not.toMatch(/fresh-access|fresh-refresh/);
    expect(updated).toEqual({ accessToken: "fresh-access" });
  });

  it("opens an account read by itself, in a list, and joined to its user", async () => {
    const sealed = sealAccountToken(ring, "stored-access");
    const account = { id: "a1", accessToken: sealed, refreshToken: null };
    const { adapter } = spyAdapter((method, query) =>
      method === "findMany"
        ? [{ ...account, user: { id: "u1" } }]
        : query.model === "account"
          ? account
          : { id: "u1", account: [account] },
    );
    const wrapped = withSealedAccountTokens(adapter, () => ring);

    const one = await wrapped.findOne({ model: "account", where: [] });
    const many = await wrapped.findMany({
      model: "account",
      where: [],
      join: { user: true },
    });
    const user = await wrapped.findOne({
      model: "user",
      where: [],
      join: { account: true },
    });

    expect((one as { accessToken: string }).accessToken).toBe("stored-access");
    expect(many).toEqual([
      {
        id: "a1",
        accessToken: "stored-access",
        refreshToken: null,
        user: { id: "u1" },
      },
    ]);
    expect(user).toEqual({
      id: "u1",
      account: [{ id: "a1", accessToken: "stored-access", refreshToken: null }],
    });
  });

  it("never seals twice, and leaves an empty or missing token alone", async () => {
    const already = sealAccountToken(ring, "x");
    const { adapter, calls } = spyAdapter(echo);
    const wrapped = withSealedAccountTokens(adapter, () => ring);

    await wrapped.create({
      model: "account",
      data: { accessToken: already, refreshToken: "", idToken: null },
    });

    expect(dataOf(calls[0])).toEqual({
      accessToken: already,
      refreshToken: "",
      idToken: null,
    });
  });

  it("never reads the key for an account with no provider tokens", async () => {
    // A password sign-in reads the credential account. It must not need the
    // root key, so an instance whose key is missing still lets people in.
    const keyRing = vi.fn(() => ring);
    const { adapter } = spyAdapter(() => ({
      id: "a1",
      providerId: "credential",
      password: "hash",
      accessToken: null,
    }));
    const wrapped = withSealedAccountTokens(adapter, keyRing);

    await wrapped.findOne({ model: "account", where: [] });
    await wrapped.create({
      model: "account",
      data: { providerId: "credential", password: "hash" },
    });

    expect(keyRing).not.toHaveBeenCalled();
  });

  it("reads a token it cannot open as absent, and says so without the token", async () => {
    const stranger = parseKeyRing({ current: newRootKey() });
    const sealed = sealAccountToken(stranger, "unreachable-token");
    const { adapter } = spyAdapter(() => ({ id: "a1", accessToken: sealed }));
    const wrapped = withSealedAccountTokens(adapter, () => ring);
    const written: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });

    try {
      const row = await wrapped.findOne({ model: "account", where: [] });
      expect(row).toEqual({ id: "a1", accessToken: null });
    } finally {
      stderr.mockRestore();
    }

    expect(written.join("")).toContain("account a1");
    expect(written.join("")).not.toContain("unreachable-token");
    expect(written.join("")).not.toContain(sealed);
  });

  it("leaves every other model alone", async () => {
    const { adapter, calls } = spyAdapter(echo);
    const wrapped = withSealedAccountTokens(adapter, () => ring);

    await wrapped.create({
      model: "session",
      data: { token: "t", accessToken: "not-an-account" },
    });
    await wrapped.update({
      model: "user",
      where: [],
      update: { accessToken: "not-an-account" },
    });

    expect(JSON.stringify(calls).match(/not-an-account/g)).toHaveLength(2);
  });

  it("seals inside a transaction too", async () => {
    // Better Auth creates a user and their first account inside one
    // transaction, on a handle the adapter underneath hands the callback.
    const inner = spyAdapter(echo);
    const outer = {
      ...inner.adapter,
      transaction: async (
        callback: (trx: typeof inner.adapter) => Promise<unknown>,
      ) => callback(inner.adapter),
    };

    const wrapped = withSealedAccountTokens(outer, () => ring);
    await (
      wrapped.transaction as (
        callback: (trx: typeof inner.adapter) => Promise<unknown>,
      ) => Promise<unknown>
    )(async (trx) => trx.create({ model: "account", data: { ...TOKENS } }));

    expect(JSON.stringify(inner.calls)).not.toContain(TOKENS.accessToken);
  });
});

/**
 * A provider served from this process, so a sign-in runs the real token
 * exchange rather than a stub of it.
 *
 * It issues numbered tokens and remembers the refresh token it was sent,
 * which is how the refresh test proves Better Auth handed the provider the
 * token itself rather than what is stored.
 */
const idp = {
  server: undefined as Server | undefined,
  url: "",
  issued: 0,
  refreshTokensReceived: [] as string[],
  subject: "idp-subject-1",
  email: "sealed@example.com",
};

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const startIdp = async () => {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      if (request.url?.startsWith("/token")) {
        if (form.get("grant_type") === "refresh_token") {
          idp.refreshTokensReceived.push(form.get("refresh_token") ?? "");
        }
        idp.issued += 1;
        const n = idp.issued;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: `idp-access-${n}`,
            refresh_token: `idp-refresh-${n}`,
            // Not verified: this provider has no discovery document, so Better
            // Auth only decodes it for the profile.
            id_token: `${base64url({ alg: "none" })}.${base64url({
              sub: idp.subject,
              email: idp.email,
              email_verified: true,
              name: "Sealed Person",
              n,
            })}.c2lnbmF0dXJl`,
            token_type: "Bearer",
            expires_in: 3600,
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

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PROVIDER = "sso-test-idp";

type Auth = ReturnType<typeof createAuth>;
let auth: Auth;

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .join("; ");

const post = (path: string, body: unknown, cookie = "") =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

/** Signs in through the provider, and returns the session cookie. */
const signInThroughProvider = async (): Promise<string> => {
  const start = await post("/sign-in/social", {
    provider: PROVIDER,
    callbackURL: "/",
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";

  const callback = await auth.handler(
    new Request(
      `${BASE_URL}/api/auth/callback/${PROVIDER}?code=a-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieFrom(start) } },
    ),
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).not.toContain("error");
  return cookieFrom(callback);
};

const storedTokens = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    access_token: string | null;
    refresh_token: string | null;
    id_token: string | null;
  }>(
    "select access_token, refresh_token, id_token from accounts where provider_id = $1",
    [PROVIDER],
  );
  return rows;
};

/** The provider account's own row id, which Better Auth's token routes take. */
const accountRowId = async (): Promise<string> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    "select id from accounts where provider_id = $1",
    [PROVIDER],
  );
  return rows[0]?.id ?? "";
};

/** Everything written to the console and the process streams meanwhile. */
const capturingOutput = () => {
  const written: string[] = [];
  const keep = (...parts: unknown[]) => {
    written.push(parts.map(String).join(" "));
    return true;
  };
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(keep),
    vi.spyOn(process.stderr, "write").mockImplementation(keep),
    ...(["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(keep),
    ),
  ];
  return {
    text: () => written.join("\n"),
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
};

describe("a sign-in through an identity provider", () => {
  beforeAll(startIdp);

  afterAll(async () => {
    await new Promise((resolve) => idp.server?.close(resolve));
  });

  beforeEach(async () => {
    const wb = await workerDb();
    await wb.truncateAllTables();
    idp.issued = 0;
    idp.refreshTokensReceived = [];
    auth = createAuth({
      pool: wb.appPool,
      secret: SECRET,
      baseUrl: BASE_URL,
      keyRing: () => ring,
      rateLimit: { enabled: false },
      ssoProviders: [
        {
          providerId: PROVIDER,
          clientId: "client-id",
          clientSecret: "client-secret",
          authorizationUrl: `${idp.url}/authorize`,
          tokenUrl: `${idp.url}/token`,
          userInfoUrl: `${idp.url}/userinfo`,
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the provider's tokens sealed, never as issued", async () => {
    const output = capturingOutput();
    try {
      await signInThroughProvider();
    } finally {
      output.restore();
    }

    const [row] = await storedTokens();
    expect(row).toBeDefined();
    for (const value of Object.values(row ?? {})) {
      expect(isSealedAccountToken(value ?? "")).toBe(true);
    }
    expect(JSON.stringify(row)).not.toMatch(/idp-access-1|idp-refresh-1/);

    // Sealed under the ring this instance was given, which rotation covers.
    expect(openAccountToken(ring, row?.access_token ?? "")).toBe(
      "idp-access-1",
    );
    expect(openAccountToken(ring, row?.refresh_token ?? "")).toBe(
      "idp-refresh-1",
    );

    // And nothing on the way wrote a token where an operator reads.
    expect(output.text()).not.toMatch(/idp-access-|idp-refresh-/);
  });

  it("reads the token back for Better Auth, which hands out what was issued", async () => {
    const session = await signInThroughProvider();

    const response = await post(
      "/get-access-token",
      { accountId: await accountRowId() },
      session,
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { accessToken: string }).accessToken,
    ).toBe("idp-access-1");
  });

  it("refreshes with the token itself, and seals the ones it gets back", async () => {
    const session = await signInThroughProvider();
    const output = capturingOutput();
    let response: Response;
    try {
      response = await post(
        "/refresh-token",
        { accountId: await accountRowId() },
        session,
      );
    } finally {
      output.restore();
    }
    expect(response.status).toBe(200);

    // The provider was sent the refresh token it issued, not the stored value.
    expect(idp.refreshTokensReceived).toEqual(["idp-refresh-1"]);

    const [row] = await storedTokens();
    expect(openAccountToken(ring, row?.access_token ?? "")).toBe(
      "idp-access-2",
    );
    expect(openAccountToken(ring, row?.refresh_token ?? "")).toBe(
      "idp-refresh-2",
    );
    expect(JSON.stringify(row)).not.toMatch(/idp-access-2|idp-refresh-2/);
    expect(output.text()).not.toMatch(/idp-access-|idp-refresh-/);
  });

  it("seals the second sign-in's fresh tokens too", async () => {
    await signInThroughProvider();
    await signInThroughProvider();

    const rows = await storedTokens();
    expect(rows).toHaveLength(1);
    expect(openAccountToken(ring, rows[0]?.access_token ?? "")).toBe(
      "idp-access-2",
    );
  });
});

/**
 * The data change that seals rows written before L-11, opened by the same
 * reader a sign-in uses. `packages/db` writes the envelope itself, because it
 * cannot depend on this package; this is what proves the two agree.
 */
describe("tokens stored before sealing existed", () => {
  const PASSWORD = "correct horse battery staple";
  const EMAIL = "legacy@example.com";

  beforeEach(async () => {
    const wb = await workerDb();
    await wb.truncateAllTables();
    auth = createAuth({
      pool: wb.appPool,
      secret: SECRET,
      baseUrl: BASE_URL,
      keyRing: () => ring,
      rateLimit: { enabled: false },
      ssoProviders: [
        {
          providerId: PROVIDER,
          clientId: "client-id",
          clientSecret: "client-secret",
          authorizationUrl: "http://127.0.0.1:9/authorize",
          tokenUrl: "http://127.0.0.1:9/token",
        },
      ],
    });
  });

  it("reads a plain row as it was, and the same after the data change seals it", async () => {
    const wb = await workerDb();
    const signUp = await post("/sign-up/email", {
      email: EMAIL,
      password: PASSWORD,
      name: "Legacy",
    });
    expect(signUp.status).toBe(200);
    const session = cookieFrom(signUp);
    const { id: userId } = ((await signUp.json()) as { user: { id: string } })
      .user;

    // What Better Auth wrote before L-11: the tokens exactly as issued. Far
    // from expiry, so reading one back does not reach for the provider.
    await wb.admin.query(
      `insert into accounts (id, user_id, account_id, provider_id,
                             access_token, refresh_token, id_token,
                             access_token_expires_at)
       values ('legacy-account', $1, 'legacy-subject', $2,
               'legacy-access', 'legacy-refresh', 'legacy-id',
               now() + interval '1 day')`,
      [userId, PROVIDER],
    );

    const readAccessToken = async () => {
      const response = await post(
        "/get-access-token",
        { accountId: "legacy-account" },
        session,
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { accessToken: string }).accessToken;
    };

    expect(await readAccessToken()).toBe("legacy-access");

    const client = await wb.admin.connect();
    try {
      const [outcome] = await runDataChanges(client, {
        scripts: [sealAccountTokens(ROOT)],
      });
      expect(outcome?.rowsChanged).toBe(1);
    } finally {
      client.release();
    }

    const [row] = await storedTokens();
    for (const value of Object.values(row ?? {})) {
      expect(isSealedAccountToken(value ?? "")).toBe(true);
    }
    expect(openAccountToken(ring, row?.refresh_token ?? "")).toBe(
      "legacy-refresh",
    );
    expect(openAccountToken(ring, row?.id_token ?? "")).toBe("legacy-id");
    expect(await readAccessToken()).toBe("legacy-access");
  });
});
