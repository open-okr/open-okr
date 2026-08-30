/**
 * The WhatsApp driver, over Meta's Cloud API (AI-NATIVE-PLAN.md §5, P5-T04a).
 *
 * **The fourth provider, and the one whose constraint is about what may be said
 * rather than how it looks.** Slack, Teams and Telegram will carry any message
 * at any time. WhatsApp will not: outside a twenty-four hour window opened by
 * the member's own last message, only templates Meta approved in advance may be
 * sent. The window is P5-T04b; this driver can send a template and says so, and
 * the capability matrix has carried `templateOnlyOutbound: true` for it since
 * P5-T01b-b.
 *
 * **No buttons, and that turns out to be exactly right.** The matrix says
 * WhatsApp has none, so the builder folds them into the text, and P5-T03b made a
 * command button degrade into the words to type. On WhatsApp that is literally
 * the instruction: reply with `resolve abc`. What began as a fix for a broken
 * link is the native shape of this provider.
 *
 * **The verification handshake is a GET, and it is not a message.** Meta proves
 * the endpoint is yours by asking it to echo a challenge before it will send
 * anything. That is the one inbound path here that carries no signature and no
 * body, so it is answered by the endpoint rather than by this driver's
 * `verifyInbound`, and it is the reason the route has a GET at all.
 *
 * **No SDK.** JSON over HTTPS, and an HMAC-SHA256 over the raw body.
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

/** The Cloud API. Pinned, because a graph version is a contract. */
const API = "https://graph.facebook.com/v21.0";

const CAPABILITIES: ChannelCapabilities = {
  outbound: true,
  inbound: true,
  richCards: false,
  // Meta has interactive reply buttons, and the product does not use them: the
  // builder folds a button into the text, which on this provider is the
  // instruction to reply with a command, and that works inside and outside the
  // window alike.
  buttons: false,
  threads: false,
  // Outside the conversation window. The builder is told which side it is on;
  // the flag says the provider has a window at all.
  templateOnlyOutbound: true,
};

export interface WhatsAppChannelOptions {
  /** The business phone number that sends. Also names the workspace inbound. */
  readonly phoneNumberId: string;
  /** The permanent access token. Never logged. */
  readonly accessToken: string;
  /** The app secret, which signs every inbound body. Never logged. */
  readonly appSecret: string;
  /** Resolves a member to the number they linked. */
  readonly numberFor: (
    recipient: ChannelRecipient,
  ) => Promise<string | null> | string | null;
  /** The language an approved template is sent in. Meta requires one. */
  readonly templateLanguage?: string;
  /** Test seam. Defaults to global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A refusal from Meta that retrying cannot fix.
 *
 * A number that is not on WhatsApp, a token the app no longer holds, and a
 * template that was never approved all say the same thing on the tenth attempt.
 */
export class WhatsAppPermanentError extends Error {
  override readonly name = "PermanentDispatchError";
  readonly detail: string;

  constructor(detail: string) {
    super(`WhatsApp refused this permanently: ${detail}`);
    this.detail = detail;
  }
}

/** One template, in the shape Meta lists it. */
export interface MetaTemplate {
  readonly id?: string;
  readonly name?: string;
  readonly language?: string;
  readonly status?: string;
  readonly category?: string;
  readonly components?: readonly {
    readonly type?: string;
    readonly text?: string;
  }[];
}

/**
 * A template's body text, which is the component Meta calls BODY.
 *
 * A template can also have a header, a footer and buttons. The body is the one
 * that carries the message and the one whose placeholders a send must fill.
 */
export function templateBody(template: MetaTemplate): string | null {
  const body = (template.components ?? []).find(
    (component) => component.type?.toUpperCase() === "BODY",
  );
  return typeof body?.text === "string" ? body.text : null;
}

/**
 * How many `{{n}}` placeholders a body has.
 *
 * Counted as the highest index rather than the number of occurrences: a body
 * that says `{{1}}` twice still takes one parameter, and Meta numbers them from
 * one with no gaps allowed. Reading the highest is what a send has to supply.
 */
export function countVariables(body: string | null): number {
  if (!body) {
    return 0;
  }
  let highest = 0;
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > highest) {
      highest = index;
    }
  }
  return highest;
}

interface GraphError {
  readonly message?: string;
  readonly code?: number;
  readonly error_subcode?: number;
}

/**
 * Which Graph errors are worth another attempt.
 *
 * 131047 is "outside the window", 132000 and its neighbours are template
 * problems, 190 is a token the app no longer holds: none of them changes on a
 * retry. A rate limit (4, 80007) and anything unrecognised do.
 */
const PERMANENT_CODES = new Set([100, 131_026, 131_047, 132_000, 132_001, 190]);

const isPermanent = (error: GraphError): boolean =>
  PERMANENT_CODES.has(error.code ?? -1);

export class WhatsAppChannel implements Channel {
  readonly provider: ChannelProvider = "whatsapp";
  readonly #phoneNumberId: string;
  readonly #accessToken: string;
  readonly #appSecret: string;
  readonly #numberFor: WhatsAppChannelOptions["numberFor"];
  readonly #templateLanguage: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: WhatsAppChannelOptions) {
    this.#phoneNumberId = options.phoneNumberId;
    this.#accessToken = options.accessToken;
    this.#appSecret = options.appSecret;
    this.#numberFor = options.numberFor;
    this.#templateLanguage = options.templateLanguage ?? "en";
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #post(body: unknown): Promise<{ id?: string }> {
    const response = await this.#fetch(
      `${API}/${encodeURIComponent(this.#phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
      };
      return {
        ...(parsed.messages?.[0]?.id ? { id: parsed.messages[0].id } : {}),
      };
    }

    const parsed = (await response.json().catch(() => ({}))) as {
      error?: GraphError;
    };
    const error = parsed.error ?? {};
    // The message, never the token: this body is the one place a log would
    // otherwise pick one up.
    const detail = error.message ?? `HTTP ${response.status}`;
    if (isPermanent(error)) {
      throw new WhatsAppPermanentError(detail);
    }
    throw new Error(`WhatsApp refused this message: ${detail}`);
  }

  async send(
    recipient: ChannelRecipient,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const number = recipient.externalId ?? (await this.#numberFor(recipient));
    if (!number) {
      return {
        delivered: false,
        suppressedReason: "this member has no linked WhatsApp number",
      };
    }
    return this.sendToChannel(number, message);
  }

  /**
   * A message to one number.
   *
   * WhatsApp has no channels in the sense the other providers do: a group has an
   * id but the Cloud API will not post into one, so `sendToChannel` addresses a
   * number like `send` does. Named for the port rather than for the provider.
   */
  async sendToChannel(
    target: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    // A template was asked for, so the caller has decided it is outside the
    // window. Sending free text here would be the send Meta refuses.
    const body = message.templateKey
      ? {
          messaging_product: "whatsapp",
          to: target,
          type: "template",
          template: {
            name: message.templateKey,
            language: { code: this.#templateLanguage },
            // Only when there are any: Meta refuses an empty components list
            // as readily as a wrong one.
            ...((message.templateParameters?.length ?? 0) > 0
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: (message.templateParameters ?? []).map(
                        (text) => ({ type: "text", text }),
                      ),
                    },
                  ],
                }
              : {}),
          },
        }
      : {
          messaging_product: "whatsapp",
          to: target,
          type: "text",
          text: { body: message.text, preview_url: true },
        };

    if (!message.templateKey && message.text.trim() === "") {
      // Meta refuses an empty body with a code this driver would report as
      // permanent, which is true but unhelpful: nothing was ever going to be
      // sent, and saying so is better than a dead letter.
      return {
        delivered: false,
        suppressedReason: "there was nothing to send",
      };
    }

    const sent = await this.#post(body);
    return {
      delivered: true,
      ...(sent.id ? { externalMessageId: sent.id } : {}),
    };
  }

  /**
   * Meta's signature over the raw body.
   *
   * `X-Hub-Signature-256` is `sha256=` and an HMAC of the exact bytes, keyed
   * with the app secret. Compared in constant time, and the length check in
   * front is not an optimisation: `timingSafeEqual` throws on a length
   * mismatch, so a forged header of the wrong size would crash the handler
   * rather than be refused.
   */
  async verifyInbound(request: InboundRequest): Promise<boolean> {
    const given =
      request.headers["x-hub-signature-256"] ??
      request.headers["X-Hub-Signature-256"];
    if (!given || this.#appSecret === "") {
      return false;
    }
    const expected = `sha256=${createHmac("sha256", this.#appSecret)
      .update(request.rawBody, "utf8")
      .digest("hex")}`;

    const a = Buffer.from(given.trim(), "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Who said what.
   *
   * The sender is the number, which is what a reply is addressed to and what the
   * identity stores. A status callback (delivered, read) arrives on the same
   * webhook and is not somebody saying something, so it parses to null.
   */
  async parseInbound(payload: string): Promise<InboundMessage | null> {
    const message = firstMessage(payload);
    if (!message) {
      return null;
    }

    const from = message.from;
    if (typeof from !== "string" || from === "") {
      return null;
    }

    const text = readText(message);
    if (text === null) {
      // An image, a location, a sticker. Real messages, and none of them is
      // something this product can act on.
      return null;
    }

    return {
      provider: "whatsapp",
      externalSenderId: from,
      text,
      ...(typeof message.id === "string"
        ? { externalMessageId: message.id }
        : {}),
    };
  }

  /**
   * The templates this business account has, as Meta holds them (P5-T04b-a).
   *
   * **Not on the `Channel` port**, and deliberately: no other provider has
   * anything like it, and a port method three drivers would have to answer
   * "not applicable" to is a port that has stopped describing what a channel is.
   * The one caller is the settings screen, which already knows it is looking at
   * WhatsApp.
   *
   * Paged, because Meta pages everything and a workspace with sixty templates
   * would otherwise silently see the first twenty-five.
   */
  async listTemplates(
    businessAccountId: string,
  ): Promise<readonly MetaTemplate[]> {
    const found: MetaTemplate[] = [];
    let url = `${API}/${encodeURIComponent(businessAccountId)}/message_templates?limit=100`;

    // Bounded rather than while(true): a paging cursor that never ends is a
    // loop this process would not come back from.
    for (let page = 0; page < 20 && url !== ""; page += 1) {
      const response = await this.#fetch(url, {
        headers: { authorization: `Bearer ${this.#accessToken}` },
      });
      if (!response.ok) {
        const parsed = (await response.json().catch(() => ({}))) as {
          error?: GraphError;
        };
        const error = parsed.error ?? {};
        const detail = error.message ?? `HTTP ${response.status}`;
        if (isPermanent(error)) {
          throw new WhatsAppPermanentError(detail);
        }
        throw new Error(`WhatsApp refused the template list: ${detail}`);
      }

      const body = (await response.json()) as {
        data?: MetaTemplate[];
        paging?: { next?: string };
      };
      found.push(...(body.data ?? []));
      url = body.paging?.next ?? "";
    }
    return found;
  }

  capabilities(): ChannelCapabilities {
    return CAPABILITIES;
  }

  async stop(): Promise<void> {
    // Nothing held open: `fetch` owns its own connections.
  }
}

/** The first message on a webhook body, or null for anything else. */
function firstMessage(payload: string): Record<string, unknown> | null {
  try {
    const body = JSON.parse(payload) as Record<string, unknown>;
    const entry = (body.entry as Record<string, unknown>[] | undefined)?.[0];
    const change = (
      entry?.changes as Record<string, unknown>[] | undefined
    )?.[0];
    const value = change?.value as Record<string, unknown> | undefined;
    const messages = value?.messages as Record<string, unknown>[] | undefined;
    return messages?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The words in one inbound message, or null when there are none.
 *
 * A reply button comes back as its own shape and carries the id it was sent
 * with, which is the command. Nothing here interprets either: the router does.
 */
function readText(message: Record<string, unknown>): string | null {
  const text = message.text as Record<string, unknown> | undefined;
  if (typeof text?.body === "string") {
    return text.body;
  }

  const interactive = message.interactive as
    | Record<string, unknown>
    | undefined;
  const button = interactive?.button_reply as
    | Record<string, unknown>
    | undefined;
  if (typeof button?.id === "string") {
    return button.id;
  }
  const list = interactive?.list_reply as Record<string, unknown> | undefined;
  if (typeof list?.id === "string") {
    return list.id;
  }
  return null;
}

/**
 * The provider's own id for one inbound delivery, for the duplicate check.
 *
 * Meta retries a webhook it did not get a 200 for, with the same message id.
 * A body with no message (a status callback) has no id worth deduplicating,
 * which the endpoint reads as "nothing to do".
 */
export function whatsAppDeliveryId(rawBody: string): string | null {
  const message = firstMessage(rawBody);
  return typeof message?.id === "string" && message.id !== ""
    ? message.id
    : null;
}

/**
 * The business number one webhook body is about.
 *
 * This is what finds the workspace before a tenant is known: one WhatsApp
 * business number belongs to one OpenOKR workspace, the same arrangement
 * Slack's team id and the Teams directory tenant have.
 */
export function whatsAppPhoneNumberId(rawBody: string): string | null {
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const entry = (body.entry as Record<string, unknown>[] | undefined)?.[0];
    const change = (
      entry?.changes as Record<string, unknown>[] | undefined
    )?.[0];
    const value = change?.value as Record<string, unknown> | undefined;
    const metadata = value?.metadata as Record<string, unknown> | undefined;
    return typeof metadata?.phone_number_id === "string" &&
      metadata.phone_number_id !== ""
      ? metadata.phone_number_id
      : null;
  } catch {
    return null;
  }
}

/**
 * The WhatsApp Business Account one webhook body belongs to (P5-T04b-a).
 *
 * On `entry[].id`, where Meta has always put it. Learned rather than configured,
 * the way the Teams service URL is: it is what the template list is asked for,
 * and asking an administrator to find it in a console when the product is
 * already being told it every time somebody writes would be a form field for
 * nothing.
 */
export function whatsAppBusinessAccountId(rawBody: string): string | null {
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const entry = (body.entry as Record<string, unknown>[] | undefined)?.[0];
    return typeof entry?.id === "string" && entry.id !== "" ? entry.id : null;
  } catch {
    return null;
  }
}

/**
 * Meta's subscription handshake, which is a GET and not a message.
 *
 * Answered with the challenge only when the token matches the one the
 * administrator chose, compared in constant time. Everything else gets null,
 * which the endpoint turns into a refusal: echoing a challenge to a caller who
 * guessed the URL would let them confirm the endpoint exists.
 */
export function verifySubscription(
  parameters: URLSearchParams,
  verifyToken: string,
): string | null {
  if (parameters.get("hub.mode") !== "subscribe" || verifyToken === "") {
    return null;
  }
  const given = parameters.get("hub.verify_token") ?? "";
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(verifyToken, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  return parameters.get("hub.challenge");
}
