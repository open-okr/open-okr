/**
 * The Slack driver (AI-NATIVE-PLAN.md §5, P5-T02a).
 *
 * **No SDK.** Slack's Web API is JSON over HTTPS and its signature scheme is
 * HMAC-SHA256 over three concatenated strings. `fetch` and `node:crypto` cover
 * both, so this adds no runtime dependency, which is a rule the repository
 * holds for a reason: a vendor SDK is a supply-chain surface and a bundle cost
 * for a driver that makes four kinds of call.
 *
 * **`verifyInbound` reads bytes and nothing else.** §6's first two steps run
 * before anything parses the body, which is why the port hands them
 * `rawBody`. A parsed object is a decision already made about untrusted input.
 *
 * **What this driver never does:** decide what a command means. §7 puts that in
 * one router generated from the action registry (P5-T06), and a driver that
 * interpreted commands itself would be the fourth copy of that logic by the
 * time Teams, WhatsApp and Telegram land. `parseInbound` returns who said what
 * and stops.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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

/** Slack's own version prefix. `v0` is the only one it has ever sent. */
const SIGNATURE_VERSION = "v0";

/**
 * How old an inbound request may be.
 *
 * Slack's own guidance is five minutes. Anything older is either a replay or a
 * clock so wrong that trusting it is worse than refusing it.
 */
const REPLAY_WINDOW_SECONDS = 300;

const API = "https://slack.com/api";

const CAPABILITIES: ChannelCapabilities = {
  outbound: true,
  inbound: true,
  richCards: true,
  buttons: true,
  threads: true,
  templateOnlyOutbound: false,
};

export interface SlackChannelOptions {
  /** The workspace's bot token, decrypted by the caller. */
  readonly botToken: string;
  /** The app's signing secret, for inbound verification. */
  readonly signingSecret: string;
  /**
   * Resolves a member to their Slack user id.
   *
   * The driver holds no member table, the same arrangement the email driver
   * has with addresses.
   */
  readonly slackUserFor: (
    recipient: ChannelRecipient,
  ) => Promise<string | null> | string | null;
  /** Test seam. Defaults to global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Test seam for the replay window. */
  readonly now?: () => number;
}

/** Slack's `chat.postMessage` and friends answer with `ok` and sometimes `error`. */
interface SlackResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly ts?: string;
  readonly channel?: { readonly id?: string } | string;
}

/**
 * A Slack error that retrying cannot fix.
 *
 * `account_inactive`, `channel_not_found` and `not_in_channel` will say the
 * same thing on the tenth attempt. Named here so the relay can dead-letter
 * them rather than spending an hour proving it.
 */
const PERMANENT_ERRORS = new Set([
  "account_inactive",
  "channel_not_found",
  "invalid_auth",
  "is_archived",
  "not_in_channel",
  "token_revoked",
  "user_not_found",
]);

export class SlackPermanentError extends Error {
  override readonly name = "PermanentDispatchError";
  readonly slackError: string;

  constructor(slackError: string) {
    super(`Slack refused this permanently: ${slackError}`);
    this.slackError = slackError;
  }
}

/**
 * A message as Block Kit.
 *
 * `text` is always present as well, because Slack uses it for notification
 * previews and for any client that cannot render blocks. A message that put
 * everything in blocks would arrive on a watch as an empty notification.
 */
export function toBlocks(
  message: ChannelMessage,
): readonly Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: message.text },
    },
  ];

  // The caller's own blocks, already shaped by whoever built the message. The
  // builder in `packages/core` only passes these to a provider that reports
  // `richCards`, so anything here was meant for Slack.
  if (message.blocks) {
    blocks.push(...(message.blocks as Record<string, unknown>[]));
  }

  if (message.buttons && message.buttons.length > 0) {
    blocks.push({
      type: "actions",
      elements: message.buttons.slice(0, 5).map((button) => ({
        type: "button",
        text: { type: "plain_text", text: button.label },
        url: button.url,
      })),
    });
  }

  return blocks;
}

export class SlackChannel implements Channel {
  readonly provider: ChannelProvider = "slack";
  readonly #botToken: string;
  readonly #signingSecret: string;
  readonly #slackUserFor: SlackChannelOptions["slackUserFor"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;

  constructor(options: SlackChannelOptions) {
    this.#botToken = options.botToken;
    this.#signingSecret = options.signingSecret;
    this.#slackUserFor = options.slackUserFor;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => Date.now());
  }

  async #call(method: string, body: unknown): Promise<SlackResponse> {
    const response = await this.#fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // A transport-level failure. Retryable: Slack having a bad minute is the
      // ordinary case here.
      throw new Error(`Slack ${method} answered HTTP ${response.status}`);
    }

    const parsed = (await response.json()) as SlackResponse;
    if (!parsed.ok) {
      const error = parsed.error ?? "unknown_error";
      if (PERMANENT_ERRORS.has(error)) {
        throw new SlackPermanentError(error);
      }
      throw new Error(`Slack ${method} refused: ${error}`);
    }
    return parsed;
  }

  /**
   * A direct message.
   *
   * `conversations.open` first, because a bot cannot post to a user id: it
   * posts to a conversation, and the direct-message conversation may not exist
   * until somebody asks for it. Slack returns the same channel id every time,
   * so this is not a channel being created on each send.
   */
  async send(
    recipient: ChannelRecipient,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const slackUser =
      recipient.externalId ?? (await this.#slackUserFor(recipient));
    if (!slackUser) {
      // Suppressed, not failed. An unlinked member is a state the product can
      // be in, and the routing layer has already decided to try anyway.
      return {
        delivered: false,
        suppressedReason: "this member has no linked Slack account",
      };
    }

    const opened = await this.#call("conversations.open", {
      users: slackUser,
    });
    const conversation =
      typeof opened.channel === "string" ? opened.channel : opened.channel?.id;
    if (!conversation) {
      throw new SlackPermanentError("no_conversation");
    }

    return this.#post(conversation, message);
  }

  /** A post to a space's own channel. The target is Slack's channel id. */
  async sendToChannel(
    target: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    return this.#post(target, message);
  }

  async #post(
    channel: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const sent = await this.#call("chat.postMessage", {
      channel,
      text: message.text,
      blocks: toBlocks(message),
      ...(message.threadKey ? { thread_ts: message.threadKey } : {}),
    });
    return {
      delivered: true,
      ...(sent.ts ? { externalMessageId: sent.ts } : {}),
    };
  }

  /**
   * §6 steps one and two, over the raw bytes.
   *
   * The comparison is timing-safe, and the length check in front of it is not
   * an optimisation: `timingSafeEqual` throws on mismatched lengths, so a
   * forged header of the wrong size would crash the handler instead of being
   * refused.
   */
  async verifyInbound(request: InboundRequest): Promise<boolean> {
    const timestamp = request.headers["x-slack-request-timestamp"];
    const signature = request.headers["x-slack-signature"];
    if (!timestamp || !signature) {
      return false;
    }

    const age = Math.abs(this.#now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > REPLAY_WINDOW_SECONDS) {
      return false;
    }

    const expected = `${SIGNATURE_VERSION}=${createHmac(
      "sha256",
      this.#signingSecret,
    )
      .update(`${SIGNATURE_VERSION}:${timestamp}:${request.rawBody}`)
      .digest("hex")}`;

    const given = Buffer.from(signature, "utf8");
    const mine = Buffer.from(expected, "utf8");
    if (given.length !== mine.length) {
      return false;
    }
    return timingSafeEqual(given, mine);
  }

  /**
   * Who said what, and nothing about what it means.
   *
   * Three shapes arrive on one endpoint: a slash command as form encoding, an
   * event callback as JSON, and an interaction as a form field holding JSON.
   * All three reduce to a sender, a text and a thread, which is the whole of
   * what the port promises.
   */
  async parseInbound(payload: string): Promise<InboundMessage | null> {
    const asJson = safeJson(payload);

    // An event callback: `event.user` and `event.text`.
    if (asJson && typeof asJson === "object") {
      const record = asJson as Record<string, unknown>;
      const event = record.event as Record<string, unknown> | undefined;
      if (event && typeof event.user === "string") {
        return {
          provider: "slack",
          externalSenderId: event.user,
          text: typeof event.text === "string" ? event.text : "",
          ...(typeof event.thread_ts === "string"
            ? { threadKey: event.thread_ts }
            : {}),
          ...(typeof event.ts === "string"
            ? { externalMessageId: event.ts }
            : {}),
        };
      }
    }

    const form = new URLSearchParams(payload);

    // An interaction: one field called `payload` holding JSON.
    const interaction = safeJson(form.get("payload") ?? "");
    if (interaction && typeof interaction === "object") {
      const record = interaction as Record<string, unknown>;
      const user = record.user as Record<string, unknown> | undefined;
      if (user && typeof user.id === "string") {
        const actions = Array.isArray(record.actions)
          ? (record.actions as Record<string, unknown>[])
          : [];
        const first = actions[0];
        return {
          provider: "slack",
          externalSenderId: user.id,
          // The action's own value, which is what a button press says. Not
          // interpreted here: a value is a string until the router reads it.
          text:
            first && typeof first.value === "string"
              ? first.value
              : typeof record.type === "string"
                ? record.type
                : "",
        };
      }
    }

    // A slash command: `user_id`, `command` and `text`.
    const userId = form.get("user_id");
    if (userId) {
      const command = form.get("command") ?? "";
      const text = form.get("text") ?? "";
      return {
        provider: "slack",
        externalSenderId: userId,
        text: `${command} ${text}`.trim(),
      };
    }

    return null;
  }

  capabilities(): ChannelCapabilities {
    return CAPABILITIES;
  }

  /** `fetch` holds no socket this driver owns. */
  async stop(): Promise<void> {}
}

function safeJson(text: string): unknown {
  if (text === "" || (text[0] !== "{" && text[0] !== "[")) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The delivery id a repeat of this request would carry (§6 step three).
 *
 * Slack does not send one identifier for all three shapes, so this builds the
 * most specific one available and falls back to the signature, which is a
 * function of the timestamp and the exact body and is therefore stable across
 * a retry of the same delivery and different for a new one.
 */
export function slackDeliveryId(input: {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
}): string | null {
  const retryOf = input.headers["x-slack-retry-num"];
  const event = safeJson(input.rawBody) as Record<string, unknown> | null;
  if (event && typeof event.event_id === "string") {
    // Slack's own id for an event, and it repeats across its retries, which is
    // exactly what makes it the right key: a retry is the same delivery.
    return event.event_id;
  }
  const signature = input.headers["x-slack-signature"];
  if (signature) {
    return retryOf ? `${signature}` : signature;
  }
  return null;
}
