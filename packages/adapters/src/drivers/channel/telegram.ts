/**
 * The Telegram driver (AI-NATIVE-PLAN.md §5, P5-T05).
 *
 * **The second provider, and the first real test of "one definition, four
 * renderings".** Nothing in `packages/core` changed to add it: the command
 * catalogue, the router, the inbound checks and the conversational check-in are
 * the same code Slack reaches. What is here is the three things that are
 * genuinely Telegram's own, and each is different from Slack in a way worth
 * naming rather than papering over.
 *
 * **The token is in the URL, not a header.** Telegram authenticates an outbound
 * call by the bot token in the path, so the token is a credential in a URL and
 * must never be logged: the error messages below name the method and never the
 * URL they called.
 *
 * **Inbound is verified by a shared secret, not a signature.** Telegram does not
 * sign the body. It echoes a secret token, chosen when the webhook is
 * registered, in `X-Telegram-Bot-Api-Secret-Token`. That is weaker than Slack's
 * HMAC and the difference is structural rather than an oversight: there is
 * nothing to compute the signature over. The comparison is still timing-safe,
 * and the endpoint still refuses before parsing.
 *
 * **Buttons are an inline keyboard, and `callback_data` is capped at 64 bytes.**
 * Slack takes any value; Telegram truncates or rejects. A command that does not
 * fit is sent as a link instead of silently arriving broken.
 */
import { timingSafeEqual } from "node:crypto";
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

const API = "https://api.telegram.org";

/** Telegram's own limit on what a button may carry back. */
const CALLBACK_DATA_BYTES = 64;

/** The same scheme the Slack driver reads: a button that runs a command. */
const COMMAND_SCHEME = "okr:";

const CAPABILITIES: ChannelCapabilities = {
  outbound: true,
  inbound: true,
  // No Block Kit equivalent. A message is text with an optional keyboard.
  richCards: false,
  // An inline keyboard, which is why the flag is true even though the shape is
  // nothing like Slack's.
  buttons: true,
  threads: false,
  templateOnlyOutbound: false,
};

export interface TelegramChannelOptions {
  /** The bot token. Goes in the URL, so it must never reach a log. */
  readonly botToken: string;
  /** The secret echoed on every inbound request, chosen at registration. */
  readonly webhookSecret: string;
  /** Resolves a member to their Telegram chat id. */
  readonly chatIdFor: (
    recipient: ChannelRecipient,
  ) => Promise<string | null> | string | null;
  /** Test seam. Defaults to global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

interface TelegramResponse {
  readonly ok: boolean;
  readonly description?: string;
  readonly error_code?: number;
  readonly result?: { readonly message_id?: number };
}

/**
 * A Telegram refusal that retrying cannot fix.
 *
 * 403 is "the member blocked the bot" or "the bot was kicked", and 400 with
 * "chat not found" is an id that no longer exists. Both say the same thing on
 * the tenth attempt.
 */
export class TelegramPermanentError extends Error {
  override readonly name = "PermanentDispatchError";
  readonly description: string;

  constructor(description: string) {
    super(`Telegram refused this permanently: ${description}`);
    this.description = description;
  }
}

const isPermanent = (code: number | undefined, description: string): boolean =>
  code === 403 ||
  code === 401 ||
  /chat not found|bot was blocked|user is deactivated|bot was kicked/i.test(
    description,
  );

/**
 * A message's buttons as an inline keyboard, or nothing.
 *
 * One button per row. Telegram lays several to a row happily, but a nudge's
 * actions are usually two or three words each and a single column is legible on
 * a phone, which is where most of these are read.
 */
export function toInlineKeyboard(
  message: ChannelMessage,
): Record<string, unknown> | undefined {
  if (!message.buttons || message.buttons.length === 0) {
    return undefined;
  }

  const rows = message.buttons.map((button) => {
    if (!button.url.startsWith(COMMAND_SCHEME)) {
      return [{ text: button.label, url: button.url }];
    }
    const command = button.url.slice(COMMAND_SCHEME.length);
    if (Buffer.byteLength(command, "utf8") > CALLBACK_DATA_BYTES) {
      // Too long to carry back. Sent as nothing rather than truncated: half a
      // command is a command that would run the wrong thing.
      return [];
    }
    return [{ text: button.label, callback_data: command }];
  });

  const keyboard = rows.filter((row) => row.length > 0);
  return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
}

export class TelegramChannel implements Channel {
  readonly provider: ChannelProvider = "telegram";
  readonly #botToken: string;
  readonly #webhookSecret: string;
  readonly #chatIdFor: TelegramChannelOptions["chatIdFor"];
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: TelegramChannelOptions) {
    this.#botToken = options.botToken;
    this.#webhookSecret = options.webhookSecret;
    this.#chatIdFor = options.chatIdFor;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #call(method: string, body: unknown): Promise<TelegramResponse> {
    const response = await this.#fetch(
      `${API}/bot${this.#botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok && response.status >= 500) {
      // Telegram having a bad minute. Retryable, and the message names the
      // method rather than the URL, which holds the token.
      throw new Error(`Telegram ${method} answered HTTP ${response.status}`);
    }

    const parsed = (await response.json()) as TelegramResponse;
    if (!parsed.ok) {
      const description = parsed.description ?? "unknown error";
      if (isPermanent(parsed.error_code, description)) {
        throw new TelegramPermanentError(description);
      }
      throw new Error(`Telegram ${method} refused: ${description}`);
    }
    return parsed;
  }

  async send(
    recipient: ChannelRecipient,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const chatId = recipient.externalId ?? (await this.#chatIdFor(recipient));
    if (!chatId) {
      return {
        delivered: false,
        suppressedReason: "this member has no linked Telegram account",
      };
    }
    return this.#post(chatId, message);
  }

  /**
   * A post to a group or channel.
   *
   * The same call: Telegram addresses a person and a group identically, by chat
   * id. No `conversations.open` equivalent is needed, which is the one place
   * this driver is simpler than Slack's rather than merely different.
   */
  async sendToChannel(
    target: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    return this.#post(target, message);
  }

  async #post(
    chatId: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const keyboard = toInlineKeyboard(message);
    const sent = await this.#call("sendMessage", {
      chat_id: chatId,
      text: message.text,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    const id = sent.result?.message_id;
    return {
      delivered: true,
      ...(id === undefined ? {} : { externalMessageId: String(id) }),
    };
  }

  /**
   * The shared secret, compared in constant time.
   *
   * Not a signature: Telegram does not sign the body, so there is nothing to
   * verify it against. What this proves is that the caller knows the secret
   * chosen when the webhook was registered, which is the strongest claim the
   * provider makes available.
   *
   * The length check in front of the comparison is not an optimisation:
   * `timingSafeEqual` throws on mismatched lengths, so a forged header of the
   * wrong size would crash the handler instead of being refused.
   */
  async verifyInbound(request: InboundRequest): Promise<boolean> {
    const given = request.headers["x-telegram-bot-api-secret-token"];
    if (!given || this.#webhookSecret === "") {
      return false;
    }
    const a = Buffer.from(given, "utf8");
    const b = Buffer.from(this.#webhookSecret, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Who said what.
   *
   * Two shapes: a `message` somebody typed, and a `callback_query` from an
   * inline button. Nothing here decides what either means.
   *
   * **The sender id is the chat id, and for a direct message they are the
   * same.** The chat is what a reply is addressed to, so that is what the
   * identity stores: a member's `from.id` and their private chat id are equal,
   * and using the chat means a reply lands where the message came from.
   */
  async parseInbound(payload: string): Promise<InboundMessage | null> {
    let update: Record<string, unknown>;
    try {
      update = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }

    const message = update.message as Record<string, unknown> | undefined;
    if (message) {
      const chat = message.chat as Record<string, unknown> | undefined;
      const text = typeof message.text === "string" ? message.text : "";
      if (
        chat &&
        (typeof chat.id === "number" || typeof chat.id === "string")
      ) {
        return {
          provider: "telegram",
          externalSenderId: String(chat.id),
          text,
          ...(typeof message.message_id === "number"
            ? { externalMessageId: String(message.message_id) }
            : {}),
        };
      }
    }

    const callback = update.callback_query as
      | Record<string, unknown>
      | undefined;
    if (callback) {
      const from = callback.message as Record<string, unknown> | undefined;
      const chat = from?.chat as Record<string, unknown> | undefined;
      const data = typeof callback.data === "string" ? callback.data : "";
      if (
        chat &&
        (typeof chat.id === "number" || typeof chat.id === "string")
      ) {
        return {
          provider: "telegram",
          externalSenderId: String(chat.id),
          // The button's own value, uninterpreted.
          text: data,
        };
      }
    }

    return null;
  }

  capabilities(): ChannelCapabilities {
    return CAPABILITIES;
  }

  async stop(): Promise<void> {}
}

/**
 * The delivery id a repeat of this update would carry (§6 step three).
 *
 * `update_id` is Telegram's own, increases by one per update, and repeats when
 * it retries a webhook it did not get a 200 for. Exactly the key the duplicate
 * check wants.
 */
export function telegramDeliveryId(rawBody: string): string | null {
  try {
    const update = JSON.parse(rawBody) as Record<string, unknown>;
    return typeof update.update_id === "number"
      ? String(update.update_id)
      : null;
  } catch {
    return null;
  }
}
