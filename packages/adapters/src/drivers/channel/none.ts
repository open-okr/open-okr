/**
 * The "no channel" driver: the default before a workspace connects Slack,
 * Teams, WhatsApp or Telegram.
 *
 * It suppresses rather than fails. A missing channel is a normal state, not
 * an error: the nudge still exists as a row with its rule key and its
 * suppression reason, so noise stays measurable and nothing is lost. Email
 * remains the always-available fallback.
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

const SUPPRESSED = "no channel provider is connected for this workspace";

const NO_CAPABILITIES: ChannelCapabilities = {
  outbound: false,
  inbound: false,
  richCards: false,
  buttons: false,
  threads: false,
  templateOnlyOutbound: false,
};

export class NoneChannel implements Channel {
  readonly provider: ChannelProvider = "none";

  async send(
    _recipient: ChannelRecipient,
    _message: ChannelMessage,
  ): Promise<DeliveryResult> {
    return { delivered: false, suppressedReason: SUPPRESSED };
  }

  async sendToChannel(
    _target: string,
    _message: ChannelMessage,
  ): Promise<DeliveryResult> {
    return { delivered: false, suppressedReason: SUPPRESSED };
  }

  /** Nothing may arrive through a provider that is not connected. */
  async verifyInbound(_request: InboundRequest): Promise<boolean> {
    return false;
  }

  async parseInbound(_payload: string): Promise<InboundMessage | null> {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return NO_CAPABILITIES;
  }
}
