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
 * **Every answer is an empty 200 except a failed verification.** §6 says so and
 * the reason is §5.3's: a helpful error confirms the workspace exists. An
 * attacker who guesses an instance learns nothing from a body, a status or a
 * timing here.
 */
import type { Channel } from "@openokr/adapters";
import {
  type ChannelConnectionKey,
  handleInbound,
  helpText,
  INBOUND_RATE_LIMIT,
  INBOUND_RATE_WINDOW_SECONDS,
  openConnection,
  routeCommand,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getCache } from "./cache";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

/** Empty, always the same, and never says why. */
export const silence = (): Response => new Response(null, { status: 200 });
const refused = (): Response => new Response(null, { status: 401 });

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
  /** Which workspace this request belongs to, or null for silence. */
  readonly resolveWorkspace: (input: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string>>;
  }) => Promise<string | null>;
  /** Builds the driver from the connection's decrypted secret, or null. */
  readonly buildDriver: (secret: string) => Channel | null;
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
  // The bytes, once. Verification covers exactly these bytes rather than a
  // re-serialisation of them.
  const rawBody = await request.text();
  const headers = headerRecord(request);

  const workspaceId = await endpoint.resolveWorkspace({ rawBody, headers });
  if (!workspaceId) {
    return silence();
  }

  const connection = await openConnection(getPool(), getKeyRing(), {
    workspaceId,
    provider: endpoint.provider,
  });
  if (!connection) {
    return silence();
  }
  const driver = endpoint.buildDriver(connection.secret);
  if (!driver) {
    return silence();
  }

  // Steps 1 and 2, before anything reads the body as data.
  if (!(await driver.verifyInbound({ headers, rawBody }))) {
    return refused();
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

  const message = await driver.parseInbound(rawBody);
  const deliveryId = endpoint.deliveryId({ rawBody, headers });
  if (!message || !deliveryId) {
    return silence();
  }

  const cache = getCache();
  const outcome = await handleInbound(getPool(), {
    workspaceId,
    provider: endpoint.provider,
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
        "Your account is linked. OpenOKR will send your nudges here.",
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
    provider: endpoint.provider,
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
