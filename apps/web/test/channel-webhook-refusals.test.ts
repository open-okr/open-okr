import {
  createHmac,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { NO_METRICS, setDefaultMetrics } from "@openokr/core";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a caller learns from a chat webhook's answer (completeness review
 * L-10).
 *
 * Every door used to answer an unknown tenant with 200 and a bad signature
 * with 401, so anybody could list the installed Slack teams, Teams tenants,
 * WhatsApp numbers and Telegram bots by sending junk and reading the status.
 * The property under test is that the two are now the same answer, byte for
 * byte, and not sooner than the refusal floor, while a request signed with
 * the right secret for an installed tenant still reaches §6's step three.
 *
 * Real drivers and real signatures throughout, in the shapes the adapter
 * suites record for each provider. What is stubbed is the database behind
 * the door: which tenants are installed, and the credential each one's
 * connection opens to. The lookup itself is proved against a real database in
 * `packages/core/test/channel-inbound.test.ts`.
 */

// Hoisted, because the test imports `@openokr/core` itself and the mock's
// factory runs as soon as it does.
const {
  pool,
  workspaceForProviderTeam,
  openConnection,
  handleInbound,
  rememberConnectionConfig,
  rateLimit,
} = vi.hoisted(() => ({
  pool: { fake: "pool" },
  workspaceForProviderTeam: vi.fn(),
  openConnection: vi.fn(),
  handleInbound: vi.fn(),
  rememberConnectionConfig: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("../lib/pool", () => ({ getPool: () => pool }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => undefined }));
vi.mock("../lib/cache", () => ({ getCache: () => ({ rateLimit }) }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OpenOKR",
}));
vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  workspaceForProviderTeam,
  openConnection,
  handleInbound,
  rememberConnectionConfig,
}));

const { REFUSAL_FLOOR_MS } = await import("../lib/channel-inbound");
const slack = await import("../app/api/channels/slack/route");
const teams = await import("../app/api/channels/teams/route");
const whatsapp = await import("../app/api/channels/whatsapp/route");
const telegram = await import("../app/api/channels/telegram/[team]/route");

/** One installed tenant per provider, and one installed with no connection. */
const INSTALLED = "installed";
const NO_CONNECTION = "installed-without-connection";
const UNKNOWN = "never-installed";

const SLACK = { botToken: "xoxb-test", signingSecret: "slack-signing-secret" };
const TELEGRAM = { botToken: "123:abc", webhookSecret: "telegram-secret" };
const WHATSAPP = {
  accessToken: "whatsapp-token",
  appSecret: "whatsapp-app-secret",
  verifyToken: "whatsapp-verify-token",
};
const APP_ID = "11111111-2222-3333-4444-555555555555";
const TEAMS = { appId: APP_ID, appPassword: "teams-password" };
const SERVICE_URL = "https://smba.trafficmanager.net/emea/";

const SECRETS: Record<string, string> = {
  slack: JSON.stringify(SLACK),
  telegram: JSON.stringify(TELEGRAM),
  whatsapp: JSON.stringify(WHATSAPP),
  teams: JSON.stringify(TEAMS),
};

const counted: Array<Record<string, string>> = [];

beforeEach(() => {
  counted.length = 0;
  setDefaultMetrics({
    ...NO_METRICS,
    count(name, labels) {
      if (name === "openokr_channel_inbound_refusals_total") {
        counted.push({ ...labels });
      }
    },
  });

  workspaceForProviderTeam
    .mockReset()
    .mockImplementation(async (_pool, input: { teamId: string }) =>
      input.teamId === INSTALLED
        ? "ws-installed"
        : input.teamId === NO_CONNECTION
          ? "ws-without-connection"
          : null,
    );
  openConnection
    .mockReset()
    .mockImplementation(
      async (_pool, _ring, input: { workspaceId: string; provider: string }) =>
        input.workspaceId === "ws-installed"
          ? {
              provider: input.provider,
              secret: SECRETS[input.provider],
              config: { teamId: INSTALLED },
            }
          : null,
    );
  // A verified request that reaches §6's step three. What happens after it
  // is `handleInbound`'s, and is proved against a database in core.
  handleInbound
    .mockReset()
    .mockResolvedValue({ kind: "ignored", reason: "no identity" });
  rememberConnectionConfig.mockReset().mockResolvedValue(undefined);
  rateLimit.mockReset().mockResolvedValue({ allowed: true });
});

afterAll(() => {
  setDefaultMetrics(NO_METRICS);
  vi.unstubAllGlobals();
});

/** Everything a caller can read off an answer, apart from when it came. */
async function readAnswer(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers.entries()],
    body: Buffer.from(await response.arrayBuffer()).toString("hex"),
  };
}

/** Sends one request and reads the answer, with how long it took. */
async function timed(send: () => Promise<Response>) {
  const started = performance.now();
  const response = await send();
  const answer = await readAnswer(response);
  return { ...answer, elapsed: performance.now() - started };
}

/**
 * The assertion every provider makes: the refusals are one answer, and no
 * refusal comes back before the floor. Five milliseconds of slack for a timer
 * that may fire a little early.
 */
function expectOneRefusal(
  answers: ReadonlyArray<Awaited<ReturnType<typeof timed>>>,
  status: number,
) {
  const [first, ...rest] = answers;
  for (const other of rest) {
    expect({ ...other, elapsed: 0 }).toEqual({ ...first, elapsed: 0 });
  }
  expect(first?.status).toBe(status);
  expect(first?.body).toBe("");
  for (const answer of answers) {
    expect(answer.elapsed).toBeGreaterThanOrEqual(REFUSAL_FLOOR_MS - 5);
  }
}

/** Nothing counted carries anything but the provider and the reason. */
function expectCounted(provider: string, reasons: readonly string[]) {
  expect(counted).toEqual(reasons.map((reason) => ({ provider, reason })));
}

describe("Slack", () => {
  const post = (
    team: string,
    options: { secret?: string; body?: string } = {},
  ) => {
    const body =
      options.body ??
      `team_id=${team}&user_id=U-sam&command=%2Fokr&text=status`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac(
      "sha256",
      options.secret ?? SLACK.signingSecret,
    )
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;
    return slack.POST(
      new NextRequest("http://localhost/api/channels/slack", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
      }),
    );
  };

  it("answers an unknown team exactly as it answers a bad signature", async () => {
    const answers = [
      await timed(() => post(UNKNOWN)),
      await timed(() => post(INSTALLED, { secret: "not-the-secret" })),
      await timed(() => post(NO_CONNECTION)),
    ];

    expectOneRefusal(answers, 401);
    expect(handleInbound).not.toHaveBeenCalled();
    expectCounted("slack", [
      "unknown_tenant",
      "failed_verification",
      "no_connection",
    ]);
  });

  it("still accepts a signed request from an installed team", async () => {
    const response = await post(INSTALLED);

    expect(response.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        workspaceId: "ws-installed",
        provider: "slack",
        externalSenderId: "U-sam",
      }),
    );
    expect(counted).toEqual([]);
  });

  it("stays silent for a request that names no team, as it always was", async () => {
    // Nothing named, so nothing about what exists can be learned from it.
    const response = await post(INSTALLED, {
      body: "user_id=U-sam&command=%2Fokr&text=status",
    });

    expect(response.status).toBe(200);
    expect(workspaceForProviderTeam).not.toHaveBeenCalled();
    expectCounted("slack", ["no_tenant"]);
  });
});

describe("Microsoft Teams", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const forger = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const KID = "route-test-key";

  // Microsoft's two documents, served from a stub. Installed once for the
  // file, because the route holds one key source for every request it
  // serves, which is the point of it.
  const keyFetches: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    keyFetches.push(url.host);
    if (url.host === "login.botframework.com") {
      return Response.json({ jwks_uri: "https://keys.example/keys" });
    }
    if (url.host === "keys.example") {
      const jwk = publicKey.export({ format: "jwk" });
      return Response.json({ keys: [{ ...jwk, kid: KID, kty: "RSA" }] });
    }
    return new Response("{}", { status: 404 });
  });

  const token = (
    claims: Record<string, unknown> = {},
    key: KeyObject = privateKey,
  ) => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signed = `${encode({ alg: "RS256", typ: "JWT", kid: KID })}.${encode({
      iss: "https://api.botframework.com",
      aud: APP_ID,
      serviceUrl: SERVICE_URL,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })}`;
    const signature = createSign("RSA-SHA256")
      .update(signed)
      .sign(key)
      .toString("base64url");
    return `${signed}.${signature}`;
  };

  const post = (tenant: string, bearer: string) =>
    teams.POST(
      new NextRequest("http://localhost/api/channels/teams", {
        method: "POST",
        body: JSON.stringify({
          type: "message",
          id: "activity-1",
          serviceUrl: SERVICE_URL,
          text: "status g-1",
          conversation: { id: "a:conversation-1" },
          from: { id: "29:user-1", aadObjectId: "aad-1" },
          channelData: { tenant: { id: tenant } },
        }),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
      }),
    );

  it("refuses a forged token before any tenant is looked up", async () => {
    const forged = token({}, forger.privateKey);
    const answers = [
      await timed(() => post(UNKNOWN, forged)),
      await timed(() => post(INSTALLED, forged)),
    ];

    expectOneRefusal(answers, 401);
    // Microsoft's keys are the same for every tenant, so the signature is
    // checked first and the lookup never runs.
    expect(workspaceForProviderTeam).not.toHaveBeenCalled();
    expectCounted("teams", ["failed_verification", "failed_verification"]);
  });

  it("answers an unknown tenant exactly as a token for another bot", async () => {
    // Signed by Microsoft, so it passes the check that needs no tenant. Only
    // the audience, which the connection holds, is wrong.
    const anotherBot = token({ aud: "another-app-id" });
    const answers = [
      await timed(() => post(UNKNOWN, token())),
      await timed(() => post(INSTALLED, anotherBot)),
      await timed(() => post(NO_CONNECTION, token())),
    ];

    expectOneRefusal(answers, 401);
    expect(handleInbound).not.toHaveBeenCalled();
    expectCounted("teams", [
      "unknown_tenant",
      "failed_verification",
      "no_connection",
    ]);
  });

  it("still accepts a token for this bot from an installed tenant, and fetches the keys once", async () => {
    const response = await post(INSTALLED, token());

    expect(response.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        workspaceId: "ws-installed",
        provider: "teams",
        externalSenderId: "a:conversation-1",
      }),
    );
    // Every request in this file shared one key source: one read of each of
    // Microsoft's documents, not two per request.
    expect(keyFetches).toEqual(["login.botframework.com", "keys.example"]);
  });
});

describe("WhatsApp", () => {
  const body = (number: string) =>
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "business-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550001111",
                  phone_number_id: number,
                },
                messages: [
                  {
                    from: "628123456789",
                    id: "wamid.abc",
                    timestamp: "1756000000",
                    type: "text",
                    text: { body: "status" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

  const post = (number: string, secret = WHATSAPP.appSecret) => {
    const raw = body(number);
    return whatsapp.POST(
      new NextRequest("http://localhost/api/channels/whatsapp", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret)
            .update(raw, "utf8")
            .digest("hex")}`,
        },
      }),
    );
  };

  const handshake = (number: string | null, verifyToken: string) => {
    const url = new URL("http://localhost/api/channels/whatsapp");
    if (number !== null) {
      url.searchParams.set("phone_number_id", number);
    }
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", verifyToken);
    url.searchParams.set("hub.challenge", "challenge-123");
    return whatsapp.GET(new NextRequest(url));
  };

  it("answers an unknown number exactly as it answers a bad signature", async () => {
    const answers = [
      await timed(() => post(UNKNOWN)),
      await timed(() => post(INSTALLED, "not-the-app-secret")),
      await timed(() => post(NO_CONNECTION)),
    ];

    expectOneRefusal(answers, 401);
    expect(handleInbound).not.toHaveBeenCalled();
    expectCounted("whatsapp", [
      "unknown_tenant",
      "failed_verification",
      "no_connection",
    ]);
  });

  it("still accepts a signed message for an installed number", async () => {
    const response = await post(INSTALLED);

    expect(response.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        workspaceId: "ws-installed",
        provider: "whatsapp",
        externalSenderId: "628123456789",
      }),
    );
  });

  it("refuses the handshake the same way for every number it will not confirm", async () => {
    const answers = [
      await timed(() => handshake(UNKNOWN, WHATSAPP.verifyToken)),
      await timed(() => handshake(INSTALLED, "not-the-verify-token")),
      await timed(() => handshake(NO_CONNECTION, WHATSAPP.verifyToken)),
      await timed(() => handshake(null, WHATSAPP.verifyToken)),
    ];

    expectOneRefusal(answers, 403);
    expectCounted("whatsapp", [
      "unknown_tenant",
      "failed_verification",
      "no_connection",
      "no_tenant",
    ]);
  });

  it("still echoes the challenge for an installed number with its token", async () => {
    const response = await handshake(INSTALLED, WHATSAPP.verifyToken);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-123");
  });
});

describe("Telegram", () => {
  const post = (bot: string, secret = TELEGRAM.webhookSecret) =>
    telegram.POST(
      new NextRequest(`http://localhost/api/channels/telegram/${bot}`, {
        method: "POST",
        body: JSON.stringify({
          update_id: 7,
          message: {
            message_id: 3,
            chat: { id: 555 },
            from: { id: 555 },
            text: "status",
          },
        }),
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
      }),
      { params: Promise.resolve({ team: bot }) },
    );

  it("answers an unknown bot exactly as it answers a wrong secret", async () => {
    const answers = [
      await timed(() => post(UNKNOWN)),
      await timed(() => post(INSTALLED, "not-the-secret")),
      await timed(() => post(NO_CONNECTION)),
    ];

    expectOneRefusal(answers, 401);
    expect(handleInbound).not.toHaveBeenCalled();
    expectCounted("telegram", [
      "unknown_tenant",
      "failed_verification",
      "no_connection",
    ]);
  });

  it("still accepts an update carrying the secret for an installed bot", async () => {
    const response = await post(INSTALLED);

    expect(response.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        workspaceId: "ws-installed",
        provider: "telegram",
        externalSenderId: "555",
      }),
    );
  });
});
