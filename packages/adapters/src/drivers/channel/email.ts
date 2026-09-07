/**
 * The email channel driver (P5-T01b-a).
 *
 * **Email is the channel that cannot be absent.** Every other provider is
 * something a workspace chooses to install; this one is the instance's own
 * mail settings, which exist from the first boot. So it needs no
 * `channel_connections` row, and routing can always fall back to it.
 *
 * It wraps the `Mailer` port rather than reimplementing SMTP, so an instance
 * on the console driver in development and an instance on a real server in
 * production go through the same channel path.
 *
 * **Buttons become links, and that is the whole degradation.** §5.2's matrix
 * gives email `buttons: yes, as links`. A message built with three action
 * buttons arrives as its text followed by three labelled URLs. Nothing is
 * dropped and nothing raises an error, which is the rule the matrix states:
 * no driver refuses a message it cannot render.
 */
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
import type { Mailer } from "../../ports/mail.ts";

/** How a recipient's address is found. The driver holds no member table. */
export type AddressLookup = (
  recipient: ChannelRecipient,
) => Promise<string | null> | string | null;

export interface EmailChannelOptions {
  readonly mailer: Mailer;
  /** Resolves a member to an email address. */
  readonly addressFor: AddressLookup;
  /** Subject used when a message carries none. */
  readonly defaultSubject?: string;
}

const CAPABILITIES: ChannelCapabilities = {
  outbound: true,
  // Inbound email is a different product: a mailbox to poll, a parser for
  // replies and quoted text, and bounce handling. AI-NATIVE-PLAN §5.2 says no
  // and this driver says no rather than pretending.
  inbound: false,
  richCards: false,
  // As links. The capability is true because the message builder should keep
  // the buttons rather than drop them.
  buttons: true,
  threads: false,
  templateOnlyOutbound: false,
};

const NO_ADDRESS = "the member has no email address";

/** Text plus one labelled link per button. */
export function renderEmailBody(message: ChannelMessage): string {
  if (!message.buttons || message.buttons.length === 0) {
    return message.text;
  }
  return [
    message.text,
    "",
    ...message.buttons.map((button) => `${button.label}: ${button.url}`),
  ].join("\n");
}

export class EmailChannel implements Channel {
  readonly provider: ChannelProvider = "email";
  readonly #mailer: Mailer;
  readonly #addressFor: AddressLookup;
  readonly #defaultSubject: string;

  constructor(options: EmailChannelOptions) {
    this.#mailer = options.mailer;
    this.#addressFor = options.addressFor;
    this.#defaultSubject = options.defaultSubject ?? "OpenOKR";
  }

  async send(
    recipient: ChannelRecipient,
    message: ChannelMessage,
  ): Promise<DeliveryResult> {
    const to = await this.#addressFor(recipient);
    if (!to) {
      // Suppressed rather than failed. A member without an address is a state
      // the product can be in, not an error a retry would fix.
      return { delivered: false, suppressedReason: NO_ADDRESS };
    }

    const sent = await this.#mailer.send({
      to,
      subject: message.subject ?? this.#defaultSubject,
      text: renderEmailBody(message),
      ...(message.idempotencyKey
        ? { idempotencyKey: message.idempotencyKey }
        : {}),
    });
    return { delivered: true, externalMessageId: sent.messageId };
  }

  /**
   * A space channel has no email equivalent.
   *
   * Suppressed rather than sent to the target as an address: `target` is a
   * provider's own channel identifier, and treating it as a mailbox would send
   * a workspace's digest to whatever "#okr-team" resolves to.
   */
  async sendToChannel(
    _target: string,
    _message: ChannelMessage,
  ): Promise<DeliveryResult> {
    return {
      delivered: false,
      suppressedReason: "email has no space channel to post to",
    };
  }

  /** Nothing arrives this way, so nothing verifies. */
  async verifyInbound(_request: InboundRequest): Promise<boolean> {
    return false;
  }

  async parseInbound(_payload: string): Promise<InboundMessage | null> {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return CAPABILITIES;
  }

  /** The mailer is owned by whoever built it, and stopped there. */
  async stop(): Promise<void> {}
}
