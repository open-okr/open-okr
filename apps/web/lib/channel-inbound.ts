/**
 * The shape every inbound channel endpoint has (AI-NATIVE-PLAN.md §6, P5-T05).
 *
 * **Extracted at the second provider, not the first.** The Slack endpoint was
 * written whole, because one copy of something is not a pattern. Telegram is the
 * second, and the two share every step that is not the provider's own: read the
 * bytes once, resolve the workspace, open the connection, verify before parsing,
 * run §6's steps three to six, and answer. Writing that twice would mean two
 * places where a security step could be reordered, and there are two more
 * providers coming.
 *
 * What stays with each endpoint is what is genuinely different: how the
 * workspace is identified, how the secret is shaped, which driver is built, and
 * whether the provider offers a form. Those arrive as callbacks.
 *
 * **Two answers, and neither says which tenants this instance has.** A request
 * the door acts on, or one from a verified sender it chooses to ignore, gets
 * an empty 200: §5.3's reason, a helpful error confirms the workspace exists.
 * A request it will not act on gets an empty 401, and that is one answer for
 * three reasons: a tenant nobody installed, an installation with no usable
 * connection, and a signature that does not match (completeness review L-10).
 * This used to answer 200 for the first two and 401 for the third, so a
 * caller with no secret at all could list which Slack teams, Teams tenants,
 * WhatsApp numbers and Telegram bots were installed by sending a junk
 * signature and reading the status. The status, the body and, within the
 * floor below, the time are now the same for all three. Only the counter an
 * operator reads tells them apart.
 *
 * The secret that proves a request is per workspace for all four providers,
 * so the lookup has to come before the signature for Slack, WhatsApp and
 * Telegram. Teams is the exception, because Microsoft signs with keys it
 * publishes: its token is checked before anything is looked up, and only the
 * audience waits for the workspace.
 */
import type { Channel } from "@openokr/adapters";
import {
  type ChannelConnectionKey,
  defaultMetrics,
  handleInbound,
  helpText,
  INBOUND_RATE_LIMIT,
  INBOUND_RATE_WINDOW_SECONDS,
  METRIC,
  openConnection,
  routeCommand,
  workspaceForProviderTeam,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getCache } from "./cache";
import { getInstanceName } from "./instance-name";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

/** Empty, always the same, and never says why. */
export const silence = (): Response => new Response(null, { status: 200 });

/**
 * Why the door would not act on a request. For the counter, never the caller.
 *
 * | Reason | Answer |
 * |---|---|
 * | `no_tenant`: the request names no tenant at all | Silence on a POST, as it always was. A caller who named nothing learns nothing about what exists, and some real deliveries carry no tenant (Slack's URL handshake, a WhatsApp account notice) |
 * | `unknown_tenant`: names one nobody installed | The refusal |
 * | `no_connection`: installed, with no connection a driver can be built from | The refusal |
 * | `failed_verification`: the signature, shared secret, token or verify token does not match | The refusal |
 */
type InboundRefusalReason =
  | "no_tenant"
  | "unknown_tenant"
  | "no_connection"
  | "failed_verification";

/**
 * The least time a refusal takes, from the moment the request arrived.
 *
 * **A floor rather than equal work.** A tenant nobody installed is refused
 * after one indexed read. An installed one with a bad signature costs that
 * read, a second transaction, a decryption and a MAC before it is refused.
 * The gap is a few milliseconds, small but measurable over enough requests,
 * and it is exactly what the status no longer gives away. Padding every
 * refusal to one floor hides it without inventing decoy work that would have
 * to be kept in step with the real thing. A quarter of a second is well above
 * that work on a loaded instance and well below the three seconds Slack, the
 * least patient of the four providers, allows.
 *
 * Only refusals wait. A provider holding the right secret never meets one,
 * so the floor costs a real message nothing.
 */
export const REFUSAL_FLOOR_MS = 250;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one refusal: counted, empty, and not sent before the floor.
 *
 * The counter carries the provider and the reason and nothing else: no
 * tenant id, no header, no byte of the payload. Every POST is refused with
 * 401, which is also what the Bot Framework expects of a failed
 * authentication. The status is a parameter only for Meta's subscription
 * handshake, a GET, which is refused with 403 by Meta's own convention.
 */
export async function refuse(
  provider: ChannelConnectionKey,
  reason: InboundRefusalReason,
  startedAt: number,
  status: 401 | 403 = 401,
): Promise<Response> {
  recordRefusal(provider, reason);
  const remaining = startedAt + REFUSAL_FLOOR_MS - Date.now();
  if (remaining > 0) {
    await pause(remaining);
  }
  return new Response(null, { status });
}

function recordRefusal(
  provider: ChannelConnectionKey,
  reason: InboundRefusalReason,
): void {
  defaultMetrics().count(METRIC.channelInboundRefusalsTotal, {
    provider,
    reason,
  });
}

const headerRecord = (request: NextRequest): Record<string, string> => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
};

/**
 * How long a half-finished conversation waits.
 *
 * §4.14's default. Resolving a workspace's own override needs a settings read on
 * a path that is already several queries deep; the override is honoured through
 * the router wherever a caller resolves it, and this is the floor.
 */
export const CONVERSATION_MINUTES = 30;

export interface InboundEndpoint {
  readonly provider: ChannelConnectionKey;
  /**
   * The provider's own name for the tenant this request is about, or null
   * when it names none: a Slack team id, a Teams directory tenant, a WhatsApp
   * business number, a Telegram bot id.
   *
   * Only the identifier. The door looks it up, so that every provider answers
   * an unknown one the same way and no route can answer it differently.
   */
  readonly tenantOf: (input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string>>;
  }) => string | null;
  /**
   * A check that needs no workspace, run before one is looked up.
   *
   * CLAUDE.md asks for the signature before anything else, and this is where
   * a provider that allows it does that. Teams is the one: Microsoft signs
   * every token with keys it publishes, so a forged token is refused before
   * the lookup. Slack, WhatsApp and Telegram sign with a secret each
   * workspace holds, so they cannot, and their driver's `verifyInbound`
   * after the lookup is the whole check.
   */
  readonly verifyFirst?: (input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string>>;
  }) => Promise<boolean>;
  /**
   * Builds the driver from the connection's decrypted secret, or null.
   *
   * The connection's `config` comes too, because Teams keeps the service URL it
   * learned there and cannot send without one (P5-T03a). Every other provider
   * ignores it.
   */
  readonly buildDriver: (
    secret: string,
    config: Readonly<Record<string, unknown>>,
  ) => Channel | null;
  /** The provider's own delivery id, for the duplicate check. */
  readonly deliveryId: (input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string>>;
  }) => string | null;
  /**
   * A provider-specific short-circuit, run after verification.
   *
   * Slack's URL-verification handshake and its form submissions both live here:
   * neither is a message, and both have to be answered before the message path
   * reads the body as one.
   */
  readonly beforeMessage?: (input: {
    readonly rawBody: string;
    readonly workspaceId: string;
    readonly secret: string;
    readonly now: Date;
  }) => Promise<Response | null>;
  /**
   * Something to record before the message is handled, having verified it
   * (P5-T03a).
   *
   * Teams uses it for the service URL, which is the only way this product ever
   * learns where to send a Teams message. Returning nothing, unlike
   * `beforeMessage`, because this is a side effect rather than an answer: a hook
   * that could short-circuit would be a second place a request can end.
   */
  readonly remember?: (input: {
    readonly rawBody: string;
    readonly workspaceId: string;
  }) => Promise<void>;
  /**
   * A chance to answer with something other than a chat reply, once the sender
   * is known. Slack opens a modal here.
   */
  readonly instead?: (input: {
    readonly rawBody: string;
    readonly workspaceId: string;
    readonly secret: string;
    readonly memberId: string;
    readonly userId: string;
    readonly text: string;
    readonly now: Date;
  }) => Promise<boolean>;
}

/**
 * Runs one inbound request through §6's order.
 *
 * The order is not rearrangeable: the signature or shared secret over the raw
 * bytes, then the replay window, then the delivery id, then the sender, then the
 * member, then the rate limit. The first two are the driver's because the
 * algorithm is the provider's own; the rest are `handleInbound`'s because they
 * are the same four questions everywhere.
 */
export async function runInbound(
  request: NextRequest,
  endpoint: InboundEndpoint,
): Promise<Response> {
  const startedAt = Date.now();
  const provider = endpoint.provider;

  // The bytes, once. Verification covers exactly these bytes rather than a
  // re-serialisation of them.
  const rawBody = await request.text();
  const headers = headerRecord(request);

  if (
    endpoint.verifyFirst &&
    !(await endpoint.verifyFirst({ rawBody, headers }))
  ) {
    return refuse(provider, "failed_verification", startedAt);
  }

  const tenant = endpoint.tenantOf({ rawBody, headers });
  if (!tenant) {
    recordRefusal(provider, "no_tenant");
    return silence();
  }

  // Step 0. From here to the signature, every way of failing is the same
  // refusal, so the answer cannot say which tenants are installed.
  const workspaceId = await workspaceForProviderTeam(getPool(), {
    provider,
    teamId: tenant,
  });
  if (!workspaceId) {
    return refuse(provider, "unknown_tenant", startedAt);
  }

  const connection = await openConnection(getPool(), getKeyRing(), {
    workspaceId,
    provider,
  });
  const driver = connection
    ? endpoint.buildDriver(connection.secret, connection.config)
    : null;
  if (!connection || !driver) {
    return refuse(provider, "no_connection", startedAt);
  }

  // Steps 1 and 2, before anything reads the body as data.
  if (!(await driver.verifyInbound({ headers, rawBody }))) {
    return refuse(provider, "failed_verification", startedAt);
  }

  const now = new Date();
  const short = await endpoint.beforeMessage?.({
    rawBody,
    workspaceId,
    secret: connection.secret,
    now,
  });
  if (short) {
    return short;
  }

  await endpoint.remember?.({ rawBody, workspaceId });

  const message = await driver.parseInbound(rawBody);
  const deliveryId = endpoint.deliveryId({ rawBody, headers });
  if (!message || !deliveryId) {
    return silence();
  }

  const cache = getCache();
  const outcome = await handleInbound(getPool(), {
    workspaceId,
    provider,
    deliveryId,
    externalSenderId: message.externalSenderId,
    text: message.text,
    now,
    async withinRateLimit(key) {
      const result = await cache.rateLimit(
        key,
        INBOUND_RATE_LIMIT,
        INBOUND_RATE_WINDOW_SECONDS,
      );
      return result.allowed;
    },
  });

  if (outcome.kind === "duplicate" || outcome.kind === "ignored") {
    // A sender the product cannot vouch for learns nothing, including whether
    // this instance exists.
    return silence();
  }

  if (outcome.kind === "rate_limited") {
    // §6 step six gives this a message rather than silence, because by now the
    // sender is a member the product knows.
    await reply(
      driver,
      message.externalSenderId,
      "That is a lot of messages at once. Try again in a minute.",
    );
    return silence();
  }

  if (outcome.kind === "linked") {
    await reply(
      driver,
      message.externalSenderId,
      [
        // The instance's name, not the software's (M-33).
        `Your account is linked. ${await getInstanceName()} will send your nudges here.`,
        "",
        helpText(),
      ].join("\n"),
    );
    return silence();
  }

  if (!outcome.userId) {
    return silence();
  }

  // A provider with a form gets to open one instead of replying.
  const handled = await endpoint.instead?.({
    rawBody,
    workspaceId,
    secret: connection.secret,
    memberId: outcome.memberId,
    userId: outcome.userId,
    text: message.text,
    now,
  });
  if (handled) {
    return silence();
  }

  const answered = await routeCommand({
    pool: getPool(),
    workspaceId,
    provider,
    memberId: outcome.memberId,
    userId: outcome.userId,
    text: message.text,
    now,
    conversationMinutes: CONVERSATION_MINUTES,
  });
  await reply(driver, message.externalSenderId, answered.text);
  return silence();
}

/**
 * Sends one reply.
 *
 * openokr:allow-side-effect: an inbound path, not a write path. Sent rather
 * than queued because a confirmation that arrived a minute after somebody typed
 * would read as a failure, and because nothing else in the product needs to
 * know it happened.
 */
async function reply(
  driver: Channel,
  externalId: string,
  text: string,
): Promise<void> {
  if (text.trim() === "") {
    return;
  }
  // openokr:allow-side-effect: an inbound path, not a write path. Nothing was
  // written by this request that a rollback could take back, and a reply queued
  // for a relay would arrive a minute after somebody typed, which reads as a
  // failure.
  await driver.send({ memberId: "", externalId }, { text });
}
