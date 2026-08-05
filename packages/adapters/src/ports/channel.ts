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
}
