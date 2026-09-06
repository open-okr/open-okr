/**
 * What each channel provider can render (AI-NATIVE-PLAN.md §5.2, P5-T01b-b).
 *
 * **Here rather than only on the drivers**, because the message builder runs on
 * the deterministic path and must work with no driver installed at all. A
 * self-hosted instance with nothing but email still has to know that Slack
 * would take buttons, or the day somebody connects Slack the messages would
 * arrive as the degraded version until a redeploy.
 *
 * Each driver reports its own row through `capabilities()`, and a test in
 * `packages/adapters` compares that against this table. Two homes for one fact
 * is a drift risk, and the answer to a drift risk is a test that fails, not a
 * comment asking people to be careful.
 */

export type ChannelProviderKey =
  | "email"
  | "slack"
  | "teams"
  | "whatsapp"
  | "telegram";

/**
 * The four that need installing.
 *
 * Email is absent because it is the instance’s own mail settings: it needs no
 * connection, holds no identity, and nothing arrives through it. Anywhere a
 * provider has to be one a person can *send from*, this is the type.
 */
export type ChannelConnectionKey = Exclude<ChannelProviderKey, "email">;

export interface ChannelCapabilityRow {
  readonly outbound: boolean;
  readonly inbound: boolean;
  readonly richCards: boolean;
  /** True when buttons survive in some form, links included. */
  readonly buttons: boolean;
  readonly threads: boolean;
  /** True when free-form outbound needs an approved template. */
  readonly templateOnlyOutbound: boolean;
}

export const CHANNEL_CAPABILITIES: Readonly<
  Record<ChannelProviderKey, ChannelCapabilityRow>
> = {
  email: {
    outbound: true,
    // Inbound email is a different product: a mailbox to poll, a parser for
    // replies and quoted text, and bounce handling. §5.2 says no.
    inbound: false,
    richCards: false,
    // As links, which is why the flag is true: the builder should keep the
    // buttons rather than drop them.
    buttons: true,
    threads: false,
    templateOnlyOutbound: false,
  },
  slack: {
    outbound: true,
    inbound: true,
    richCards: true,
    buttons: true,
    threads: true,
    templateOnlyOutbound: false,
  },
  teams: {
    outbound: true,
    inbound: true,
    richCards: true,
    buttons: true,
    threads: false,
    templateOnlyOutbound: false,
  },
  whatsapp: {
    outbound: true,
    inbound: true,
    richCards: false,
    buttons: false,
    threads: false,
    // Outside its conversation window. The builder is told which side of the
    // window it is on; the flag says the provider has one at all.
    templateOnlyOutbound: true,
  },
  telegram: {
    outbound: true,
    inbound: true,
    richCards: false,
    // An inline keyboard.
    buttons: true,
    threads: false,
    templateOnlyOutbound: false,
  },
};

export function capabilitiesFor(
  provider: ChannelProviderKey,
): ChannelCapabilityRow {
  return CHANNEL_CAPABILITIES[provider];
}
