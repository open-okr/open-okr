/**
 * The Channel port (TECHNICAL-PLAN §5, AI-NATIVE-PLAN §5.1).
 *
 * One interface for email, Slack, Teams, WhatsApp and Telegram. Providers
 * differ, so `capabilities()` reports what each supports and the message
 * builder degrades to plain text with a link rather than failing.
 *
 * Inbound payloads are untrusted: `verifyInbound` runs before anything else
 * looks at the body, and an unlinked sender is never honoured.
 */

export type ChannelProvider =
  | "email"
  | "slack"
  | "teams"
  | "whatsapp"
  | "telegram"
  | "none";

export interface ChannelMessage {
  /** Always required: the fallback every provider can render. */
  readonly text: string;
  readonly subject?: string;
  /** Rich blocks, already shaped for the provider by the message builder. */
  readonly blocks?: readonly Record<string, unknown>[];
  readonly buttons?: readonly { label: string; url: string }[];
  readonly threadKey?: string;
  /** Required by template-only providers outside a conversation window. */
  readonly templateKey?: string;
  /**
   * The values a template's placeholders take, in placeholder order
   * (P5-T04b-b).
   *
   * Only meaningful beside `templateKey`. Meta refuses a send whose parameter
   * count does not match the template, so this is built from a mapping whose
   * count was checked when an administrator saved it.
   */
  readonly templateParameters?: readonly string[];
  readonly idempotencyKey?: string;
}

export interface ChannelRecipient {
  readonly memberId: string;
  /** The member's verified identity with this provider, when linked. */
  readonly externalId?: string;
}

export interface DeliveryResult {
  readonly delivered: boolean;
  /** Present when the provider accepted the message. */
  readonly externalMessageId?: string;
  /** Present when the driver chose not to send, for example no link, quiet
   * hours, or a provider that is off. Never an error: suppression is normal. */
  readonly suppressedReason?: string;
}

export interface InboundRequest {
  readonly headers: Readonly<Record<string, string>>;
  /** The raw body exactly as received. Signatures cover bytes, not objects. */
  readonly rawBody: string;
}

export interface InboundMessage {
  readonly provider: ChannelProvider;
  readonly externalSenderId: string;
  readonly text: string;
  readonly threadKey?: string;
  readonly externalMessageId?: string;
  /**
   * A short-lived token letting the product open a form in the provider's own
   * client (P5-T02b).
   *
   * On the port rather than only on the Slack driver, because Teams has the
   * same idea under a different name and the endpoint that decides "form or
   * conversation" should not branch on which provider it is talking to. Absent
   * for a provider with no modal, and absent for a message that arrived
   * without one, which is what makes the conversational path the fallback
   * rather than the exception.
   */
  readonly triggerId?: string;
}

/**
 * A form somebody filled in, as the provider handed it back (P5-T02b).
 *
 * Separate from `InboundMessage` because it is not a message: nobody typed it,
 * it has no text, and what it carries is one answer per field. A driver that
 * flattened it into `text` would be inventing a sentence the member never said.
 */
export interface InboundSubmission {
  readonly provider: ChannelProvider;
  readonly externalSenderId: string;
  /** What the form was about, put there by whoever opened it. */
  readonly reference: string;
  /** One entry per field, by the name the driver was given. */
  readonly fields: Readonly<Record<string, string>>;
}

export interface ChannelCapabilities {
  readonly outbound: boolean;
  readonly inbound: boolean;
  readonly richCards: boolean;
  readonly buttons: boolean;
  readonly threads: boolean;
  /** True when free-form outbound needs an approved template, as WhatsApp
   * does outside its conversation window. */
  readonly templateOnlyOutbound: boolean;
}

export interface Channel {
  readonly provider: ChannelProvider;
  send(
    recipient: ChannelRecipient,
    message: ChannelMessage,
  ): Promise<DeliveryResult>;
  sendToChannel(
    target: string,
    message: ChannelMessage,
  ): Promise<DeliveryResult>;
  /** Verifies the payload's signature. False means: discard, do not parse. */
  verifyInbound(request: InboundRequest): Promise<boolean>;
  parseInbound(payload: string): Promise<InboundMessage | null>;
  capabilities(): ChannelCapabilities;
  /** Releases whatever this driver holds open. `NoneChannel` owns nothing; a
   * real provider driver holding its own HTTP client or socket is not exempt
   * from closing it. */
  stop(): Promise<void>;
}
