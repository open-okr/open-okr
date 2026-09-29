/**
 * Which channel a message takes, and when (AI-NATIVE-PLAN.md §5.4, P5-T01b-b).
 *
 * One pure function, so the decision is testable without a provider, without a
 * database and without a clock. Everything it needs is loaded by the caller and
 * passed in, which is what makes "an unlinked member falls back to email" a
 * three-line test rather than a fixture.
 *
 * **In-app is never routed away.** The channel this returns is where the
 * *message* goes; the inbox row is written whatever it says, because §5.4's
 * last line is that a snooze never silences a review-inbox obligation. The
 * channel is where the product goes to find somebody. The product is where the
 * obligation lives.
 */
import { deferralFor } from "@openokr/method";
import type { ChannelProviderKey } from "./capabilities.ts";

/** `app` is in-app only: a member who has asked for no messages at all. */
export type PrimaryChannel = "app" | ChannelProviderKey;

/** Where a message actually goes. `in_app` sends nothing outside the product. */
export type DeliveryChannel = "in_app" | ChannelProviderKey;

export interface RoutingMember {
  readonly memberId: string;
  readonly primaryChannel: PrimaryChannel;
  /** IANA name. Used only to turn `now` into the member's own clock. */
  readonly localTime: { readonly hour: number; readonly minute: number };
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  /**
   * Providers this member has proved an identity on.
   *
   * Verified only. An unverified identity is somebody's claim, and sending to
   * a claim is how a nudge about one person's goal reaches another person.
   */
  readonly verifiedProviders: readonly ChannelProviderKey[];
}

export interface RoutingInput {
  readonly member: RoutingMember;
  /**
   * Whether this one delivers through quiet hours.
   *
   * The same flag the suppression rules read, and it means the same thing:
   * the ladder has widened past the person who owns the work.
   */
  readonly urgent: boolean;
  /** Providers the workspace has connected and that are not in `error`. */
  readonly connectedProviders: readonly ChannelProviderKey[];
  /**
   * The rule's own channel, when the workspace set one (P6-G21).
   *
   * `nudge_rules.channel_override` has been stored since P4-T04b and read by
   * nothing, so a workspace that routed a rule to Slack was answered with the
   * member's own primary channel and no error. Null is the member's choice,
   * which is the default and the respectful answer.
   */
  readonly channelOverride?: PrimaryChannel | null;
  readonly now: Date;
}

export interface Delivery {
  readonly channel: DeliveryChannel;
  /** When it may be sent. Later than `now` only inside quiet hours. */
  readonly sendAt: Date;
  /**
   * Why this is not the member's primary channel, when it is not.
   *
   * Carried so the message log can say what happened without the reader
   * having to reconstruct it from three tables.
   */
  readonly fallbackReason?: string;
}

/**
 * Whether one channel can actually reach this member.
 *
 * Three separate ways it cannot, and they are different facts: the workspace
 * never connected the provider, the member never linked their account, or the
 * member asked for in-app only. Naming which one is what lets the settings
 * screen tell them the useful half.
 *
 * Asked of whichever channel the message is headed for, the member's own or a
 * rule's (completeness review M-23). It used to be asked of the member's own
 * channel only, so a rule routed to Slack reached Slack for a member who had
 * never linked it, and the driver dropped it there with nobody told.
 */
function channelProblem(
  channel: PrimaryChannel,
  input: RoutingInput,
): string | null {
  if (channel === "app") {
    return null;
  }
  if (channel === "email") {
    // Email needs no connection and no identity: it is the instance's own mail
    // settings and every member has an address.
    return null;
  }
  if (!input.connectedProviders.includes(channel)) {
    return `${channel} is not connected for this workspace`;
  }
  if (!input.member.verifiedProviders.includes(channel)) {
    return `this member has not linked their ${channel} account`;
  }
  return null;
}

/** Where a channel that can be reached sends the message. */
const deliveryChannelOf = (channel: PrimaryChannel): DeliveryChannel =>
  channel === "app" ? "in_app" : channel;

/**
 * The channel and the time.
 *
 * §5.4's order, and the order matters: the channel is chosen first and the
 * quiet-hours delay is applied to whatever was chosen, so a member whose Slack
 * is unreachable at two in the morning gets an email at seven rather than a
 * Slack message at seven that still cannot be delivered.
 *
 * **A rule's own channel is checked exactly as the member's is** (completeness
 * review M-23). When it can reach them it wins. When it cannot, the message
 * falls through to the member's own route, which is the default route and
 * ends where §5.2 says every channel's fallback is: email. The member's own
 * channel comes before email because it is the one other thing the product
 * knows about where this person reads, and a member who asked for in-app only
 * stays in the product rather than being mailed because a rule could not
 * reach them somewhere else.
 */
export function resolveDelivery(input: RoutingInput): Delivery {
  const override = input.channelOverride ?? null;
  const overrideProblem = override ? channelProblem(override, input) : null;

  let channel: DeliveryChannel;
  const reasons: string[] = [];
  if (override && !overrideProblem) {
    // A rule override is a routing decision about the message; the member's
    // quiet hours below are a decision about the person, and the override
    // does not touch those.
    channel = deliveryChannelOf(override);
  } else {
    if (override && overrideProblem) {
      reasons.push(
        `this rule is routed to ${override}, but ${overrideProblem}`,
      );
    }
    const primary = input.member.primaryChannel;
    const primaryProblem = channelProblem(primary, input);
    if (primaryProblem) {
      reasons.push(primaryProblem);
    }
    // Email, the always-available baseline, rather than nothing.
    channel = primaryProblem ? "email" : deliveryChannelOf(primary);
  }

  const minutes = deferralFor({
    urgent: input.urgent,
    localTime: input.member.localTime,
    quietHours: input.member.quietHours,
  });
  const sendAt =
    minutes > 0 ? new Date(input.now.getTime() + minutes * 60_000) : input.now;

  return {
    channel,
    sendAt,
    ...(reasons.length > 0 ? { fallbackReason: reasons.join("; ") } : {}),
  };
}

/**
 * Where a failed send goes next.
 *
 * Email, unless email is what just failed. A retry on the channel that just
 * refused the message is a second identical failure, and two failures is how a
 * member ends up with two reconnect notices for one broken channel.
 */
export function fallbackAfterFailure(
  failed: DeliveryChannel,
): DeliveryChannel | null {
  return failed === "email" || failed === "in_app" ? null : "email";
}
