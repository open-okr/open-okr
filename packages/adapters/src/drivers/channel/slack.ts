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
  InboundSubmission,
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

/**
 * How a button says "run this command" rather than "open this page".
 *
 * A scheme rather than a second field on `ChannelMessage`, because every
 * provider renders a button differently and only some can carry a value: the
 * email driver turns the same button into a labelled link, and a link to
 * `okr:checkin ...` is one nobody can click, which is why only a provider
 * that reports `buttons` is ever given one.
 */
const COMMAND_SCHEME = "okr:";

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
        // **A command becomes a Slack action; anything else stays a link.**
        // A button whose url is an `okr:` command is not a place a browser can
        // go, so it is sent as a value Slack posts back to the endpoint, which
        // is what makes "Check in" on a nudge start the flow in the
        // conversation it arrived in rather than opening a browser tab
        // (P5-T02b). Every other button is a real URL and stays one, because a
        // link into the product is the right answer for a link into the
        // product.
        ...(button.url.startsWith(COMMAND_SCHEME)
          ? {
              value: button.url.slice(COMMAND_SCHEME.length),
              action_id: "okr_command",
            }
          : { url: button.url }),
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
          // A button press carries one too, so pressing "Check in" on a nudge
          // can open the form rather than starting four messages (P5-T02b).
          ...(typeof record.trigger_id === "string"
            ? { triggerId: record.trigger_id }
            : {}),
        };
      }
    }

    // A slash command: `user_id`, `command` and `text`.
    const userId = form.get("user_id");
    if (userId) {
      const command = form.get("command") ?? "";
      const text = form.get("text") ?? "";
      const trigger = form.get("trigger_id");
      return {
        provider: "slack",
        externalSenderId: userId,
        text: `${command} ${text}`.trim(),
        // Short-lived, and only present on an interaction Slack expects a
        // form for. Its absence is what makes the conversational path the
        // fallback rather than an error (P5-T02b).
        ...(trigger ? { triggerId: trigger } : {}),
      };
    }

    return null;
  }

  /**
   * Opens a form in the member's own Slack client (P5-T02b).
   *
   * Not on the `Channel` port: a port method every driver must implement and
   * two of the four cannot is a port that lies. The endpoint asks for a
   * `triggerId` from the message instead, and its absence is what routes a
   * member to the conversational path.
   *
   * The trigger is valid for about three seconds, so this is called before
   * anything slow. A failure here is not a failure to check in: the caller
   * falls back to asking the questions one at a time.
   */
  async openView(
    triggerId: string,
    view: Record<string, unknown>,
  ): Promise<void> {
    await this.#call("views.open", { trigger_id: triggerId, view });
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

/**
 * The check-in form, as Block Kit (P5-T02b).
 *
 * Three inputs in one view, which is what a provider with a modal buys over
 * four messages: a member sees every question at once and can change an answer
 * before submitting. The conversational path in `packages/core` asks the same
 * questions in METHOD.md §3.2's order, and both end in the same registry
 * action.
 *
 * **The key results are not on the form.** A modal can hold them and the next
 * task can add them; what would be wrong is a form that silently dropped a
 * number somebody typed, so until the fields exist the values stay with the
 * conversational path and the browser.
 *
 * `private_metadata` carries the goal, which is how the submission knows what
 * it was about: Slack hands the view back with no memory of who opened it.
 */
export function checkInView(input: {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly statuses: readonly string[];
}): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: "openokr_check_in",
    private_metadata: input.goalId,
    title: { type: "plain_text", text: "Check in" },
    submit: { type: "plain_text", text: "Publish" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${input.goalTitle}*` },
      },
      {
        type: "input",
        block_id: "status",
        label: { type: "plain_text", text: "How is it going?" },
        element: {
          type: "static_select",
          action_id: "value",
          options: input.statuses.map((status) => ({
            text: { type: "plain_text", text: status.replace(/_/g, " ") },
            value: status,
          })),
        },
      },
      {
        type: "input",
        block_id: "confidence",
        label: {
          type: "plain_text",
          text: "How confident are you it lands, 0 to 10?",
        },
        element: { type: "plain_text_input", action_id: "value" },
      },
      {
        type: "input",
        block_id: "narrative",
        label: { type: "plain_text", text: "One line on why" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
        },
      },
    ],
  };
}

/**
 * Reads a submitted view, or null when this payload is not one.
 *
 * Slack's shape is `view.state.values[block_id][action_id]`, and which key
 * holds the answer depends on the element: a select puts it under
 * `selected_option.value` and a text input under `value`. Flattened here
 * because that is provider knowledge, and `packages/core` should receive one
 * answer per field rather than Slack's tree.
 */
export function parseViewSubmission(payload: string): InboundSubmission | null {
  const form = new URLSearchParams(payload);
  const raw = safeJson(form.get("payload") ?? "") ?? safeJson(payload);
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.type !== "view_submission") {
    return null;
  }
  const user = record.user as Record<string, unknown> | undefined;
  const view = record.view as Record<string, unknown> | undefined;
  if (!user || typeof user.id !== "string" || !view) {
    return null;
  }

  const state = view.state as Record<string, unknown> | undefined;
  const values = (state?.values ?? {}) as Record<
    string,
    Record<string, Record<string, unknown>>
  >;

  const fields: Record<string, string> = {};
  for (const [blockId, actions] of Object.entries(values)) {
    for (const action of Object.values(actions)) {
      const selected = action.selected_option as
        | Record<string, unknown>
        | undefined;
      const value =
        typeof selected?.value === "string"
          ? selected.value
          : typeof action.value === "string"
            ? action.value
            : null;
      if (value !== null) {
        fields[blockId] = value;
      }
    }
  }

  return {
    provider: "slack",
    externalSenderId: user.id,
    reference:
      typeof view.private_metadata === "string" ? view.private_metadata : "",
    fields,
  };
}
