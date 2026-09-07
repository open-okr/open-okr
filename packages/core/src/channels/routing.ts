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
 * Whether the member's primary channel can actually be reached.
 *
 * Three separate ways it cannot, and they are different facts: the workspace
 * never connected the provider, the member never linked their account, or the
 * member asked for in-app only. Naming which one is what lets the settings
 * screen tell them the useful half.
 */
function primaryChannelProblem(input: RoutingInput): string | null {
  const primary = input.member.primaryChannel;
  if (primary === "app") {
    return null;
  }
  if (primary === "email") {
    // Email needs no connection and no identity: it is the instance's own mail
    // settings and every member has an address.
    return null;
  }
  if (!input.connectedProviders.includes(primary)) {
    return `${primary} is not connected for this workspace`;
  }
  if (!input.member.verifiedProviders.includes(primary)) {
    return `this member has not linked their ${primary} account`;
  }
  return null;
}

/**
 * The channel and the time.
 *
 * §5.4's order, and the order matters: the channel is chosen first and the
 * quiet-hours delay is applied to whatever was chosen, so a member whose Slack
 * is unreachable at two in the morning gets an email at seven rather than a
 * Slack message at seven that still cannot be delivered.
 */
export function resolveDelivery(input: RoutingInput): Delivery {
  const problem = primaryChannelProblem(input);
  const primary = input.member.primaryChannel;

  const channel: DeliveryChannel =
    primary === "app"
      ? "in_app"
      : problem
        ? // Email, the always-available baseline, rather than nothing.
          "email"
        : primary;

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
    ...(problem ? { fallbackReason: problem } : {}),
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
