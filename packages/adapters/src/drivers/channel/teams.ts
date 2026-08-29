/**
 * The Microsoft Teams driver (AI-NATIVE-PLAN.md §5, P5-T03a).
 *
 * **The third provider, and the first with real asymmetry between the two
 * directions.** Slack signs inbound with a shared secret and authenticates
 * outbound with a bot token. Telegram echoes a secret one way and puts a token
 * in the URL the other. Teams does neither: outbound needs an OAuth2
 * client-credentials token from Microsoft, and inbound arrives as a token
 * Microsoft signed, which has to be verified against keys Microsoft publishes.
 * That is more moving parts, and each of them is specified, so each is testable
 * for the same reason it would work in production.
 *
 * **No SDK.** The Bot Framework's wire protocol is JSON over HTTPS and its
 * inbound token is an ordinary RS256 JWT. `fetch` and `node:crypto` cover both,
 * and Node can turn a published JWK straight into a public key, so no runtime
 * dependency was added for this.
 *
 * **The service URL is learned, not configured.** There is no fixed endpoint for
 * sending: every inbound activity carries the `serviceUrl` for its own region,
 * and outbound must go back to that one. A driver with no service URL cannot
 * send at all, which is why a workspace whose bot has never been spoken to
 * suppresses with that reason rather than failing. The inbound door records it
 * on the connection so the next outbound message has one.
 *
 * **The token is bound to the service URL.** Microsoft signs a `serviceUrl`
 * claim into every inbound token, and checking it is what stops a caller who has
 * a valid token for some other bot from pointing this instance's replies at a
 * host they control. Verified below, alongside the audience and the issuer.
 */
import { createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import type {
  Channel,
  ChannelCapabilities,
  ChannelMessage,
  ChannelProvider,
  ChannelRecipient,
  DeliveryResult,
  InboundMessage,
  InboundRequest,
} from "../../ports/channel.ts";

/** Where a bot's outbound token comes from. */
const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";

/** The scope a Bot Framework token is issued for. */
const TOKEN_SCOPE = "https://api.botframework.com/.default";

/** Where the keys that sign inbound tokens are published. */
const OPENID_CONFIGURATION =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";

/** The only issuer this driver accepts. */
const ISSUER = "https://api.botframework.com";

/** The same scheme the Slack buttons and the Telegram keyboard already use. */
const COMMAND_SCHEME = "okr:";

/**
 * How long a fetched key set is trusted.
 *
 * Microsoft rotates these, and a driver that fetched them per request would add
 * a round trip to every inbound message. Twenty-four hours is what the Bot
 * Framework's own guidance suggests, and a token signed by a key that has just
 * rotated in is refused until the cache turns over, which is a delay rather than
 * a wrong answer.
 */
const KEY_CACHE_SECONDS = 24 * 60 * 60;

const CAPABILITIES: ChannelCapabilities = {
  outbound: true,
  inbound: true,
  // Adaptive cards. P5-T03a sends text; P5-T03b sends the cards themselves.
  richCards: true,
  buttons: true,
  // Teams has replies to an activity, but the product's threading model is one
  // message per subject and nothing yet asks for more.
  threads: false,
  templateOnlyOutbound: false,
};

export interface TeamsChannelOptions {
  /** The bot's application id, which is also the token audience. */
  readonly appId: string;
  /** The bot's client secret. Never logged. */
  readonly appPassword: string;
  /**
   * Where to send. Learned from an inbound activity and held on the connection;
   * absent for a workspace whose bot has never been spoken to.
   */
  readonly serviceUrl?: string;
  /** Resolves a member to their Teams conversation id. */
  readonly conversationFor: (
    recipient: ChannelRecipient,
  ) => Promise<string | null> | string | null;
  /** Test seam. Defaults to global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Test seam, so a verification test can supply its own clock. */
  readonly now?: () => Date;
}

/**
 * A refusal from Teams that retrying cannot fix.
 *
 * A bot removed from a tenant, a conversation that no longer exists, or
 * credentials the directory has revoked all say the same thing on the tenth
 * attempt as on the first.
 */
export class TeamsPermanentError extends Error {
  override readonly name = "PermanentDispatchError";
  readonly detail: string;

  constructor(detail: string) {
    super(`Teams refused this permanently: ${detail}`);
    this.detail = detail;
  }
}

/** Trims trailing slashes without a regular expression. 47 is `/`. */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

/** base64url, which is what a JWT's parts are encoded in. */
const fromBase64Url = (value: string): Buffer =>
  Buffer.from(value, "base64url");

interface JsonWebKey {
  readonly kid?: string;
  readonly kty?: string;
  readonly n?: string;
  readonly e?: string;
  readonly endorsements?: readonly string[];
}

/**
 * One inbound token, taken apart without being trusted.
 *
 * Returns null for anything that is not three base64url parts of JSON, which is
 * every string that is not a JWT at all.
 */
export function decodeToken(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signed: string;
  signature: Buffer;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  try {
    return {
      header: JSON.parse(fromBase64Url(headerPart).toString("utf8")),
      payload: JSON.parse(fromBase64Url(payloadPart).toString("utf8")),
      signed: `${headerPart}.${payloadPart}`,
      signature: fromBase64Url(signaturePart),
    };
  } catch {
    return null;
  }
}

/**
 * The activity's own service URL, read before the token is trusted.
 *
 * Needed because the token binds a service URL and the two have to match: the
 * check is worthless if it compares the token's claim with itself.
 */
function serviceUrlOf(rawBody: string): string | null {
  try {
    const activity = JSON.parse(rawBody) as Record<string, unknown>;
    return typeof activity.serviceUrl === "string" ? activity.serviceUrl : null;
  } catch {
    return null;
  }
}

/** Compares two strings without leaking where they first differ. */
function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class TeamsChannel implements Channel {
  readonly provider: ChannelProvider = "teams";
  readonly #appId: string;
  readonly #appPassword: string;
  readonly #serviceUrl: string | undefined;
  readonly #conversationFor: TeamsChannelOptions["conversationFor"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;

  /** The outbound token, and when it stops being usable. */
  #token: { value: string; expiresAt: number } | null = null;
  /** The published signing keys, and when they should be fetched again. */
  #keys: { keys: readonly JsonWebKey[]; expiresAt: number } | null = null;

  constructor(options: TeamsChannelOptions) {
    this.#appId = options.appId;
    this.#appPassword = options.appPassword;
    this.#serviceUrl = options.serviceUrl;
    this.#conversationFor = options.conversationFor;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * The outbound token, fetched and then reused until it is nearly expired.
   *
   * Microsoft issues these for an hour. Refreshing a minute early rather than at
   * the boundary means a message never fails because a token expired between
   * being chosen and being used.
   */
  async #accessToken(): Promise<string> {
    const now = this.#now().getTime();
    if (this.#token && this.#token.expiresAt > now) {
      return this.#token.value;
    }

    const response = await this.#fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.#appId,
        client_secret: this.#appPassword,
        scope: TOKEN_SCOPE,
      }).toString(),
    });

    if (response.status === 400 || response.status === 401) {
      // Credentials the directory does not accept. Retrying will not change
      // that, and the message never carries the secret it was refused for.
      throw new TeamsPermanentError(
        `the directory refused these credentials (HTTP ${response.status})`,
      );
    }
    if (!response.ok) {
      throw new Error(`Teams token endpoint answered HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      throw new Error("Teams token endpoint returned no token.");
    }
    this.#token = {
      value: body.access_token,
      expiresAt: now + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
    };
    return body.access_token;
  }

  async send(
    recipient: ChannelRecipient,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const conversation =
      recipient.externalId ?? (await this.#conversationFor(recipient));
    if (!conversation) {
      return {
        delivered: false,
        suppressedReason: "this member has no linked Teams account",
      };
    }
    return this.sendToChannel(conversation, message);
  }

  /**
   * A post to a conversation, which in Teams is one shape for a person, a group
   * chat and a channel alike.
   */
  async sendToChannel(
    target: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    if (!this.#serviceUrl) {
      // Not a failure: a workspace whose bot has never been spoken to has no
      // endpoint to send to, and there is no way to discover one. Saying so is
      // better than a dead letter nobody can act on.
      return {
        delivered: false,
        suppressedReason:
          "this workspace's Teams bot has not been messaged yet, so there is no service URL to reply to",
      };
    }

    const token = await this.#accessToken();
    const url = `${withoutTrailingSlashes(this.#serviceUrl)}/v3/conversations/${encodeURIComponent(target)}/activities`;
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(toActivity(message)),
    });

    if (response.status === 403 || response.status === 404) {
      throw new TeamsPermanentError(
        response.status === 404
          ? "that conversation no longer exists"
          : "this bot is not allowed in that conversation",
      );
    }
    if (!response.ok) {
      throw new Error(`Teams refused this activity: HTTP ${response.status}`);
    }

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
    };
    return {
      delivered: true,
      ...(body.id ? { externalMessageId: body.id } : {}),
    };
  }

  /** Microsoft's published signing keys, cached. */
  async #signingKeys(): Promise<readonly JsonWebKey[]> {
    const now = this.#now().getTime();
    if (this.#keys && this.#keys.expiresAt > now) {
      return this.#keys.keys;
    }

    const configuration = await this.#fetch(OPENID_CONFIGURATION);
    if (!configuration.ok) {
      throw new Error(
        `Could not read Teams' key configuration: HTTP ${configuration.status}`,
      );
    }
    const { jwks_uri } = (await configuration.json()) as {
      jwks_uri?: string;
    };
    if (!jwks_uri) {
      throw new Error("Teams' key configuration named no key set.");
    }

    const set = await this.#fetch(jwks_uri);
    if (!set.ok) {
      throw new Error(`Could not read Teams' keys: HTTP ${set.status}`);
    }
    const { keys } = (await set.json()) as { keys?: JsonWebKey[] };
    this.#keys = {
      keys: keys ?? [],
      expiresAt: now + KEY_CACHE_SECONDS * 1000,
    };
    return this.#keys.keys;
  }

  /**
   * Verifies the token Microsoft signed, before anything reads the body.
   *
   * Five things have to hold, and each is checked for its own reason:
   *
   * | Check | What it stops |
   * |---|---|
   * | signature against a published key | anybody forging an activity |
   * | `iss` is the Bot Framework | a token from another Microsoft service |
   * | `aud` is this bot's app id | a valid token issued for a different bot |
   * | `exp` has not passed | a token captured and replayed later |
   * | `serviceUrl` matches the activity | replies pointed at a host an attacker owns |
   *
   * The last is the one it would be easiest to leave out and the one whose
   * absence is worst: the service URL is where this driver sends, so a token
   * that did not bind it would let a caller choose the destination.
   */
  async verifyInbound(request: InboundRequest): Promise<boolean> {
    const header =
      request.headers.authorization ?? request.headers.Authorization;
    const match = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
    if (!match?.[1]) {
      return false;
    }

    const token = decodeToken(match[1]);
    if (!token) {
      return false;
    }

    const algorithm = token.header.alg;
    const kid = token.header.kid;
    if (algorithm !== "RS256" || typeof kid !== "string") {
      // Only RS256, named explicitly: accepting whatever the header asks for is
      // how a `none` algorithm gets through.
      return false;
    }

    let keys: readonly JsonWebKey[];
    try {
      keys = await this.#signingKeys();
    } catch {
      // Microsoft unreachable. Refusing is the safe answer: the alternative is
      // accepting an unverified activity while their endpoint is down.
      return false;
    }
    const jwk = keys.find((one) => one.kid === kid);
    if (jwk?.kty !== "RSA" || !jwk.n || !jwk.e) {
      return false;
    }

    let verified = false;
    try {
      const key = createPublicKey({
        key: { kty: "RSA", n: jwk.n, e: jwk.e },
        format: "jwk",
      });
      verified = createVerify("RSA-SHA256")
        .update(token.signed)
        .verify(key, token.signature);
    } catch {
      return false;
    }
    if (!verified) {
      return false;
    }

    const payload = token.payload;
    if (typeof payload.iss !== "string" || !sameString(payload.iss, ISSUER)) {
      return false;
    }
    if (
      typeof payload.aud !== "string" ||
      !sameString(payload.aud, this.#appId)
    ) {
      return false;
    }
    const expiry = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    if (expiry <= this.#now().getTime()) {
      return false;
    }

    const claimed = payload.serviceUrl;
    const actual = serviceUrlOf(request.rawBody);
    if (typeof claimed !== "string" || !actual) {
      return false;
    }
    return sameString(
      withoutTrailingSlashes(claimed),
      withoutTrailingSlashes(actual),
    );
  }

  /**
   * Who said what.
   *
   * The sender is the conversation, not the user, for the same reason as
   * Telegram: a reply is addressed to a conversation, so that is what the
   * identity has to store for the product to be able to answer.
   *
   * Teams prefixes a message to a bot in a channel with the bot's own mention,
   * which arrives in the text. It is stripped, because a command router should
   * not have to know that `<at>OKR</at> status g-1` is the same as `status g-1`.
   */
  async parseInbound(payload: string): Promise<InboundMessage | null> {
    let activity: Record<string, unknown>;
    try {
      activity = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (activity.type !== "message") {
      // A member joining, a conversation starting, a typing indicator. Real
      // events, and none of them is somebody saying something.
      return null;
    }

    const conversation = activity.conversation as
      | Record<string, unknown>
      | undefined;
    const id = conversation?.id;
    if (typeof id !== "string" || id === "") {
      return null;
    }

    const raw = typeof activity.text === "string" ? activity.text : "";
    const value = activity.value as Record<string, unknown> | undefined;
    // A card action arrives with no text and a `value` the card put there.
    const text =
      raw.trim() === "" && value && typeof value.command === "string"
        ? value.command
        : stripMentions(raw);

    return {
      provider: "teams",
      externalSenderId: id,
      text,
      ...(typeof activity.id === "string"
        ? { externalMessageId: activity.id }
        : {}),
    };
  }

  capabilities(): ChannelCapabilities {
    return CAPABILITIES;
  }

  async stop(): Promise<void> {
    // Nothing held open: `fetch` owns its own connections and the two caches
    // are plain objects.
  }
}

/**
 * The bot's own mention, removed.
 *
 * Teams sends `<at>OKR Coach</at> status g-1` when somebody addresses the bot in
 * a channel. Everything between the tags is the bot's display name, which is
 * whatever the tenant called it, so the tag is what this matches rather than any
 * particular name.
 */
export function stripMentions(text: string): string {
  return text.replace(/<at>[^<]*<\/at>/g, "").trim();
}

/**
 * One message as a Bot Framework activity.
 *
 * Text only in P5-T03a. Buttons become a plain list of links under the message,
 * which is what every provider's fallback looks like: the adaptive card that
 * renders them as real actions is P5-T03b, and a half-built card would be worse
 * than a link that works.
 */
export function toActivity(message: ChannelMessage): Record<string, unknown> {
  const links = (message.buttons ?? []).filter(
    (button) => !button.url.startsWith(COMMAND_SCHEME),
  );
  const text =
    links.length === 0
      ? message.text
      : [
          message.text,
          "",
          ...links.map((button) => `[${button.label}](${button.url})`),
        ].join("\n");

  return {
    type: "message",
    textFormat: "markdown",
    text,
  };
}

/**
 * The provider's own id for one inbound activity, for the duplicate check.
 *
 * Teams retries an activity it did not get a 200 for, with the same id, which is
 * exactly what the check is for.
 */
export function teamsDeliveryId(rawBody: string): string | null {
  try {
    const activity = JSON.parse(rawBody) as Record<string, unknown>;
    return typeof activity.id === "string" && activity.id !== ""
      ? activity.id
      : null;
  } catch {
    return null;
  }
}

/**
 * The Azure directory tenant one activity came from.
 *
 * This is what finds the workspace before a tenant is known: one Teams tenant
 * installs into one OpenOKR workspace, the same arrangement Slack's team id has.
 */
export function teamsTenantId(rawBody: string): string | null {
  try {
    const activity = JSON.parse(rawBody) as Record<string, unknown>;
    const data = activity.channelData as Record<string, unknown> | undefined;
    const tenant = data?.tenant as Record<string, unknown> | undefined;
    if (typeof tenant?.id === "string" && tenant.id !== "") {
      return tenant.id;
    }
    const conversation = activity.conversation as
      | Record<string, unknown>
      | undefined;
    return typeof conversation?.tenantId === "string" &&
      conversation.tenantId !== ""
      ? conversation.tenantId
      : null;
  } catch {
    return null;
  }
}

/** The service URL an activity says to reply to. Null when it says none. */
export function teamsServiceUrl(rawBody: string): string | null {
  return serviceUrlOf(rawBody);
}
