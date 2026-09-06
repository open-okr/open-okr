import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  stripMentions,
  TeamsChannel,
  TeamsPermanentError,
  teamsDeliveryId,
  teamsServiceUrl,
  teamsTenantId,
  toActivity,
  toAdaptiveCard,
} from "../src/drivers/channel/teams.ts";

/**
 * The Teams driver (P5-T03a).
 *
 * **The verification tests sign real tokens with a real key pair.** Microsoft's
 * scheme is fully specified, so a token this test forges is refused for exactly
 * the reason a forged one would be refused in production: there is no stand-in
 * anywhere in the signature path. What these cannot prove is that Microsoft
 * accepts what the driver sends, which needs an Azure application registration
 * and is recorded as such on the task's row.
 */

const APP_ID = "11111111-2222-3333-4444-555555555555";
const SERVICE_URL = "https://smba.trafficmanager.net/emea/";
const NOW = new Date("2026-08-29T09:00:00.000Z");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const KID = "test-key-1";

/** The published key set, in the shape Microsoft publishes it. */
function jwks(key: KeyObject = publicKey): unknown {
  const jwk = key.export({ format: "jwk" }) as Record<string, unknown>;
  return { keys: [{ ...jwk, kid: KID, kty: "RSA" }] };
}

/** One signed token, with whatever claims a test wants to break. */
function sign(
  claims: Record<string, unknown>,
  options: {
    readonly header?: Record<string, unknown>;
    readonly key?: KeyObject;
  } = {},
): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: KID,
    ...(options.header ?? {}),
  };
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signed = `${encode(header)}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256")
    .update(signed)
    .sign(options.key ?? privateKey)
    .toString("base64url");
  return `${signed}.${signature}`;
}

const goodClaims = () => ({
  iss: "https://api.botframework.com",
  aud: APP_ID,
  serviceUrl: SERVICE_URL,
  exp: Math.floor(NOW.getTime() / 1000) + 300,
});

const activity = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "message",
    id: "activity-1",
    serviceUrl: SERVICE_URL,
    text: "status g-1",
    conversation: { id: "a:conversation-1" },
    from: { id: "29:user-1", aadObjectId: "aad-1" },
    channelData: { tenant: { id: "tenant-1" } },
    ...over,
  });

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}

let calls: Call[] = [];
let tokenAnswer: { status: number; body: unknown };
let sendAnswer: { status: number; body: unknown };
let keysAnswer: unknown;

const stubFetch: typeof globalThis.fetch = async (input, init) => {
  const url = String(input);
  calls.push({
    url,
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : "",
    headers: (init?.headers ?? {}) as Record<string, string>,
  });

  // **Matched by host and path, not by substring.** A stub that routed on
  // `url.includes("login.microsoftonline.com")` would also answer for
  // `https://attacker.example/?x=login.microsoftonline.com`, which is a habit
  // worth not having even in a test: CodeQL flags it at high severity wherever
  // it appears, and it is right that the pattern is the problem rather than the
  // file it is in.
  const host = new URL(url).host;
  const path = new URL(url).pathname;

  if (host === "login.botframework.com") {
    expect(path).toContain("openidconfiguration");
    return Response.json({ jwks_uri: "https://keys.example/keys" });
  }
  if (url === "https://keys.example/keys") {
    return Response.json(keysAnswer as object);
  }
  if (host === "login.microsoftonline.com") {
    return new Response(JSON.stringify(tokenAnswer.body), {
      status: tokenAnswer.status,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify(sendAnswer.body), {
    status: sendAnswer.status,
    headers: { "content-type": "application/json" },
  });
};

const driver = (over: Record<string, unknown> = {}) =>
  new TeamsChannel({
    appId: APP_ID,
    appPassword: "a-secret-nobody-should-see",
    serviceUrl: SERVICE_URL,
    conversationFor: () => null,
    fetch: stubFetch,
    now: () => NOW,
    ...over,
  });

beforeEach(() => {
  calls = [];
  tokenAnswer = {
    status: 200,
    body: { access_token: "outbound-token", expires_in: 3600 },
  };
  sendAnswer = { status: 200, body: { id: "sent-1" } };
  keysAnswer = jwks();
});

describe("sending", () => {
  it("gets a token and posts the activity to the service URL", async () => {
    const result = await driver().sendToChannel("a:conversation-1", {
      text: "Your check-in is due.",
    });

    expect(result.delivered).toBe(true);
    expect(result.externalMessageId).toBe("sent-1");

    const token = calls[0] as Call;
    expect(new URL(token.url).host).toBe("login.microsoftonline.com");
    expect(token.body).toContain("grant_type=client_credentials");
    expect(token.body).toContain("api.botframework.com");

    const sent = calls[1] as Call;
    expect(sent.url).toBe(
      "https://smba.trafficmanager.net/emea/v3/conversations/a%3Aconversation-1/activities",
    );
    expect(sent.headers.authorization).toBe("Bearer outbound-token");
    expect(JSON.parse(sent.body)).toMatchObject({
      type: "message",
      text: "Your check-in is due.",
    });
  });

  it("reuses the token rather than fetching one per message", async () => {
    const teams = driver();
    await teams.sendToChannel("c1", { text: "one" });
    await teams.sendToChannel("c1", { text: "two" });

    expect(
      calls.filter(
        (call) => new URL(call.url).host === "login.microsoftonline.com",
      ),
    ).toHaveLength(1);
  });

  it("suppresses rather than failing when the bot has never been messaged", async () => {
    const result = await driver({ serviceUrl: undefined }).sendToChannel("c1", {
      text: "hello",
    });

    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toContain("service URL");
    // Nothing was attempted: there is nowhere to attempt it against.
    expect(calls).toHaveLength(0);
  });

  it("suppresses for a member with no linked account", async () => {
    const result = await driver().send({ memberId: "m1" }, { text: "hello" });
    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toContain("no linked Teams account");
  });

  it("dead-letters credentials the directory refuses, rather than retrying", async () => {
    tokenAnswer = { status: 401, body: { error: "invalid_client" } };
    await expect(
      driver().sendToChannel("c1", { text: "hello" }),
    ).rejects.toBeInstanceOf(TeamsPermanentError);
  });

  it("dead-letters a conversation that is gone, and retries a bad minute", async () => {
    sendAnswer = { status: 404, body: {} };
    await expect(
      driver().sendToChannel("c1", { text: "hello" }),
    ).rejects.toBeInstanceOf(TeamsPermanentError);

    sendAnswer = { status: 503, body: {} };
    const retryable = driver().sendToChannel("c1", { text: "hello" });
    await expect(retryable).rejects.toThrow(/HTTP 503/);
    await expect(retryable).rejects.not.toBeInstanceOf(TeamsPermanentError);
  });

  it("never puts the secret in an error", async () => {
    tokenAnswer = { status: 400, body: {} };
    const error = await driver()
      .sendToChannel("c1", { text: "hello" })
      .catch((thrown: Error) => thrown);
    expect(String(error)).not.toContain("a-secret-nobody-should-see");
  });
});

describe("the activity a message becomes", () => {
  it("stays a plain message when there is nothing for a card to hold", () => {
    // Wrapping every sentence in a card would make an ordinary reply look like
    // a form.
    expect(toActivity({ text: "Hello" })).toEqual({
      type: "message",
      textFormat: "markdown",
      text: "Hello",
    });
  });

  it("becomes a card the moment there is an action or a block", () => {
    const built = toActivity({
      text: "A dependency blocker has been open for 26 hours.",
      buttons: [{ label: "Resolve", url: "okr:resolve abc" }],
    });

    expect(built.type).toBe("message");
    // The text is still there: it is what the notification preview and an
    // accessibility reader use, and what a client that cannot render the card
    // falls back to.
    expect(built.text).toContain("26 hours");
    const attachments = built.attachments as { contentType: string }[];
    expect(attachments[0]?.contentType).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
  });

  it("renders a command as a submit action and a link as an open action", () => {
    const card = toAdaptiveCard({
      text: "A blocker needs you.",
      buttons: [
        { label: "Resolve", url: "okr:resolve abc" },
        { label: "Open the board", url: "https://okr.example/spaces/1" },
      ],
    });

    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Resolve",
        // Read back off the activity's `value` on the way in, which is what
        // makes a card button reach the same router a typed command does.
        data: { command: "resolve abc" },
      },
      {
        type: "Action.OpenUrl",
        title: "Open the board",
        url: "https://okr.example/spaces/1",
      },
    ]);
  });

  it("puts the builder's blocks in the card's body, after the text", () => {
    const card = toAdaptiveCard({
      text: "A blocker needs you.",
      blocks: [
        { type: "FactSet", facts: [{ title: "Open for", value: "26 hours" }] },
      ],
    });

    const body = card.body as Record<string, unknown>[];
    expect(body[0]).toMatchObject({ type: "TextBlock" });
    expect(body[1]).toMatchObject({ type: "FactSet" });
  });

  it("declares a schema and a version, so a client knows what it is reading", () => {
    const card = toAdaptiveCard({
      text: "x",
      buttons: [{ label: "a", url: "okr:b" }],
    });
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");
    expect(card.$schema).toContain("adaptivecards.io");
  });

  it("carries no actions key at all when there are no buttons", () => {
    const card = toAdaptiveCard({
      text: "x",
      blocks: [{ type: "TextBlock", text: "y" }],
    });
    expect(card.actions).toBeUndefined();
  });
});
describe("verifying an inbound activity", () => {
  const verify = (
    token: string,
    body = activity(),
    over: Record<string, unknown> = {},
  ) =>
    driver(over).verifyInbound({
      headers: { authorization: `Bearer ${token}` },
      rawBody: body,
    });

  it("accepts a token Microsoft would have signed", async () => {
    expect(await verify(sign(goodClaims()))).toBe(true);
  });

  it("refuses a token signed by the wrong key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(await verify(sign(goodClaims(), { key: other.privateKey }))).toBe(
      false,
    );
  });

  it("refuses a token for another bot", async () => {
    expect(await verify(sign({ ...goodClaims(), aud: "another-app-id" }))).toBe(
      false,
    );
  });

  it("refuses a token from another issuer", async () => {
    expect(
      await verify(
        sign({ ...goodClaims(), iss: "https://login.microsoftonline.com/" }),
      ),
    ).toBe(false);
  });

  it("refuses a token that has expired", async () => {
    expect(
      await verify(
        sign({
          ...goodClaims(),
          exp: Math.floor(NOW.getTime() / 1000) - 1,
        }),
      ),
    ).toBe(false);
  });

  /**
   * The check it would be easiest to leave out, and the one whose absence is
   * worst: the service URL is where replies go.
   */
  it("refuses a token whose service URL is not the activity's", async () => {
    const token = sign({
      ...goodClaims(),
      serviceUrl: "https://attacker.example/",
    });
    expect(await verify(token)).toBe(false);
  });

  it("accepts a service URL that differs only by a trailing slash", async () => {
    const token = sign({
      ...goodClaims(),
      serviceUrl: "https://smba.trafficmanager.net/emea",
    });
    expect(await verify(token)).toBe(true);
  });

  it("refuses an algorithm it was not asked to trust", async () => {
    // `none` is the classic one. The header asking for it is not a reason.
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const unsigned = `${encode({ alg: "none", kid: KID })}.${encode(goodClaims())}.`;
    expect(await verify(unsigned)).toBe(false);
  });

  it("refuses a token signed by a key that is not published", async () => {
    keysAnswer = { keys: [] };
    expect(await verify(sign(goodClaims()))).toBe(false);
  });

  it("refuses when Microsoft's keys cannot be read at all", async () => {
    keysAnswer = undefined;
    const failing: typeof globalThis.fetch = async (input) =>
      new URL(String(input)).host === "login.botframework.com"
        ? new Response("", { status: 503 })
        : new Response("{}", { status: 200 });
    const teams = new TeamsChannel({
      appId: APP_ID,
      appPassword: "x",
      serviceUrl: SERVICE_URL,
      conversationFor: () => null,
      fetch: failing,
      now: () => NOW,
    });
    expect(
      await teams.verifyInbound({
        headers: { authorization: `Bearer ${sign(goodClaims())}` },
        rawBody: activity(),
      }),
    ).toBe(false);
  });

  it("refuses anything that is not a bearer token at all", async () => {
    for (const header of ["", "Basic abc", "Bearer", "Bearer not.a.jwt"]) {
      expect(
        await driver().verifyInbound({
          headers: { authorization: header },
          rawBody: activity(),
        }),
      ).toBe(false);
    }
  });

  it("caches the keys rather than fetching them per request", async () => {
    const teams = driver();
    const token = sign(goodClaims());
    await teams.verifyInbound({
      headers: { authorization: `Bearer ${token}` },
      rawBody: activity(),
    });
    await teams.verifyInbound({
      headers: { authorization: `Bearer ${token}` },
      rawBody: activity(),
    });
    expect(
      calls.filter(
        (call) => new URL(call.url).host === "login.botframework.com",
      ),
    ).toHaveLength(1);
  });
});

describe("reading an inbound activity", () => {
  it("takes the conversation as the sender, because that is what a reply reaches", async () => {
    const parsed = await driver().parseInbound(activity());
    expect(parsed).toEqual({
      provider: "teams",
      externalSenderId: "a:conversation-1",
      text: "status g-1",
      externalMessageId: "activity-1",
    });
  });

  it("strips the bot's own mention, whatever the tenant named it", async () => {
    const parsed = await driver().parseInbound(
      activity({ text: "<at>OKR Coach</at> status g-1" }),
    );
    expect(parsed?.text).toBe("status g-1");
    expect(stripMentions("<at>Anything At All</at>  checkin")).toBe("checkin");
  });

  it("reads a card action's command when there is no text", async () => {
    const parsed = await driver().parseInbound(
      activity({ text: "", value: { command: "checkin g-1" } }),
    );
    expect(parsed?.text).toBe("checkin g-1");
  });

  it("ignores everything that is not somebody saying something", async () => {
    for (const type of ["conversationUpdate", "typing", "installationUpdate"]) {
      expect(await driver().parseInbound(activity({ type }))).toBeNull();
    }
    expect(await driver().parseInbound("not json")).toBeNull();
    expect(
      await driver().parseInbound(activity({ conversation: {} })),
    ).toBeNull();
  });
});

describe("what the endpoint reads before the driver does", () => {
  it("finds the delivery id, for the duplicate check", () => {
    expect(teamsDeliveryId(activity())).toBe("activity-1");
    expect(teamsDeliveryId("{}")).toBeNull();
    expect(teamsDeliveryId("nonsense")).toBeNull();
  });

  it("finds the tenant, which is what names the workspace", () => {
    expect(teamsTenantId(activity())).toBe("tenant-1");
    // Some activities carry it on the conversation instead.
    expect(
      teamsTenantId(
        activity({
          channelData: {},
          conversation: { id: "c", tenantId: "t2" },
        }),
      ),
    ).toBe("t2");
    expect(teamsTenantId("{}")).toBeNull();
  });

  it("finds the service URL, which is what outbound needs", () => {
    expect(teamsServiceUrl(activity())).toBe(SERVICE_URL);
    expect(teamsServiceUrl("{}")).toBeNull();
  });
});

describe("what it says it can do", () => {
  it("reports rich cards and buttons, and no template window", () => {
    expect(driver().capabilities()).toEqual({
      outbound: true,
      inbound: true,
      richCards: true,
      buttons: true,
      threads: false,
      templateOnlyOutbound: false,
    });
  });
});
