import { describe, expect, it } from "vitest";
import { buildMessage, withLinkedButtons } from "../src/channels/builder.ts";
import { CHANNEL_CAPABILITIES } from "../src/channels/capabilities.ts";
import {
  fallbackAfterFailure,
  type RoutingMember,
  resolveDelivery,
} from "../src/channels/routing.ts";

/**
 * Routing and the message builder (AI-NATIVE-PLAN.md §5.2 and §5.4, P5-T01b-b).
 *
 * Both are pure, which is the point: "an unlinked member falls back to email"
 * should be three lines and no fixture.
 */

const NOW = new Date("2026-08-27T09:00:00Z");

const member = (over: Partial<RoutingMember> = {}): RoutingMember => ({
  memberId: "m-1",
  primaryChannel: "email",
  localTime: { hour: 9, minute: 0 },
  quietHours: null,
  verifiedProviders: [],
  ...over,
});

describe("which channel", () => {
  it("uses the primary channel when the workspace and the member both have it", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "slack", verifiedProviders: ["slack"] }),
      urgent: false,
      connectedProviders: ["slack"],
      now: NOW,
    });
    expect(delivery.channel).toBe("slack");
    expect(delivery.fallbackReason).toBeUndefined();
  });

  it("falls back to email when the member has not linked their account", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "slack", verifiedProviders: [] }),
      urgent: false,
      connectedProviders: ["slack"],
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.fallbackReason).toMatch(/has not linked/);
  });

  it("falls back to email when the workspace never connected the provider", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "teams", verifiedProviders: ["teams"] }),
      urgent: false,
      connectedProviders: [],
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.fallbackReason).toMatch(/not connected/);
  });

  it("names which of the two is missing, because they are different problems", () => {
    // The settings screen tells a member to link their account, and tells an
    // administrator to connect the workspace. One reason string could not.
    const unlinked = resolveDelivery({
      member: member({ primaryChannel: "slack" }),
      urgent: false,
      connectedProviders: ["slack"],
      now: NOW,
    });
    const unconnected = resolveDelivery({
      member: member({ primaryChannel: "slack", verifiedProviders: ["slack"] }),
      urgent: false,
      connectedProviders: [],
      now: NOW,
    });
    expect(unlinked.fallbackReason).not.toBe(unconnected.fallbackReason);
  });

  it("sends nothing outside the product for a member who asked for in-app only", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "app" }),
      urgent: false,
      connectedProviders: ["slack"],
      now: NOW,
    });
    expect(delivery.channel).toBe("in_app");
    // Not a fallback: this is what they asked for.
    expect(delivery.fallbackReason).toBeUndefined();
  });

  it("needs neither a connection nor an identity for email", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "email" }),
      urgent: false,
      connectedProviders: [],
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.fallbackReason).toBeUndefined();
  });
});

/**
 * A rule's own channel (P6-G21, completeness review M-23).
 *
 * The override was taken on trust: the reachability check looked at the
 * member's primary channel and never at the channel the rule named, so a rule
 * routed to Slack for a member who had never linked Slack was queued to Slack
 * and suppressed by the driver. No email, and nothing saying why.
 */
describe("a rule's own channel", () => {
  it("is honoured when the member can be reached on it", () => {
    const delivery = resolveDelivery({
      member: member({ verifiedProviders: ["slack"] }),
      urgent: false,
      connectedProviders: ["slack"],
      channelOverride: "slack",
      now: NOW,
    });
    expect(delivery.channel).toBe("slack");
    expect(delivery.fallbackReason).toBeUndefined();
  });

  it("falls back to email when the member has not linked the override's provider", () => {
    const delivery = resolveDelivery({
      member: member(),
      urgent: false,
      connectedProviders: ["slack"],
      channelOverride: "slack",
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.fallbackReason).toMatch(/routed to slack/);
    expect(delivery.fallbackReason).toMatch(/has not linked their slack/);
  });

  it("falls back to email when the workspace never connected the override's provider", () => {
    const delivery = resolveDelivery({
      member: member({ verifiedProviders: ["teams"] }),
      urgent: false,
      connectedProviders: [],
      channelOverride: "teams",
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.fallbackReason).toMatch(/teams is not connected/);
  });

  it("falls back to the member's own channel when that one works", () => {
    // The workspace's choice could not be honoured, so the member's is the
    // next best thing the product knows. Email is where that route ends, not
    // where it starts.
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "slack", verifiedProviders: ["slack"] }),
      urgent: false,
      connectedProviders: ["slack", "teams"],
      channelOverride: "teams",
      now: NOW,
    });
    expect(delivery.channel).toBe("slack");
    expect(delivery.fallbackReason).toMatch(/has not linked their teams/);
  });

  it("ends with email when neither the override nor the member's own channel works", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "telegram" }),
      urgent: false,
      connectedProviders: ["slack"],
      channelOverride: "slack",
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    // Both problems, because both are somebody's to fix.
    expect(delivery.fallbackReason).toMatch(/slack/);
    expect(delivery.fallbackReason).toMatch(/telegram is not connected/);
  });

  it("keeps a member who asked for in-app only in the product when the override cannot reach them", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "app" }),
      urgent: false,
      connectedProviders: ["slack"],
      channelOverride: "slack",
      now: NOW,
    });
    expect(delivery.channel).toBe("in_app");
    expect(delivery.fallbackReason).toMatch(/routed to slack/);
  });

  it("needs nothing for an override to email, whatever the member's own channel is", () => {
    // Not a fallback: the rule asked for email and email is what it got. The
    // member's broken Slack is not this message's problem.
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "slack" }),
      urgent: false,
      connectedProviders: [],
      channelOverride: "email",
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.fallbackReason).toBeUndefined();
  });

  it("keeps an override to in-app inside the product", () => {
    const delivery = resolveDelivery({
      member: member({ primaryChannel: "slack", verifiedProviders: ["slack"] }),
      urgent: false,
      connectedProviders: ["slack"],
      channelOverride: "app",
      now: NOW,
    });
    expect(delivery.channel).toBe("in_app");
    expect(delivery.fallbackReason).toBeUndefined();
  });

  it("still defers inside quiet hours whichever channel it lands on", () => {
    const delivery = resolveDelivery({
      member: member({
        quietHours: { start: "22:00", end: "07:00" },
        localTime: { hour: 2, minute: 0 },
      }),
      urgent: false,
      connectedProviders: ["slack"],
      channelOverride: "slack",
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.sendAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("when", () => {
  const night = { start: "22:00", end: "07:00" };

  it("sends now when the member is awake", () => {
    const delivery = resolveDelivery({
      member: member({ quietHours: night, localTime: { hour: 9, minute: 0 } }),
      urgent: false,
      connectedProviders: [],
      now: NOW,
    });
    expect(delivery.sendAt).toEqual(NOW);
  });

  it("queues to the edge of the window rather than dropping the message", () => {
    const delivery = resolveDelivery({
      member: member({ quietHours: night, localTime: { hour: 2, minute: 0 } }),
      urgent: false,
      connectedProviders: [],
      now: NOW,
    });
    expect(delivery.sendAt.getTime() - NOW.getTime()).toBe(5 * 60 * 60_000);
  });

  it("wakes somebody for an escalation, and only for an escalation", () => {
    const asleep = member({
      quietHours: night,
      localTime: { hour: 2, minute: 0 },
    });
    expect(
      resolveDelivery({
        member: asleep,
        urgent: true,
        connectedProviders: [],
        now: NOW,
      }).sendAt,
    ).toEqual(NOW);
  });

  it("chooses the channel before the delay, so a queued message is not queued to a dead one", () => {
    // A member asleep whose Slack is unreachable gets an email at seven, not a
    // Slack message at seven that would fail the same way.
    const delivery = resolveDelivery({
      member: member({
        primaryChannel: "slack",
        quietHours: night,
        localTime: { hour: 2, minute: 0 },
      }),
      urgent: false,
      connectedProviders: [],
      now: NOW,
    });
    expect(delivery.channel).toBe("email");
    expect(delivery.sendAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("after a failure", () => {
  it("retries a provider on email", () => {
    expect(fallbackAfterFailure("slack")).toBe("email");
  });

  it("does not retry email on email", () => {
    // A retry on the channel that just refused is a second identical failure,
    // and two failures is how one broken channel produces two notices.
    expect(fallbackAfterFailure("email")).toBeNull();
  });
});

describe("the message builder", () => {
  const draft = {
    text: "Your check-in is due.",
    subject: "Check in",
    blocks: [{ type: "section" }],
    buttons: [
      { label: "Check in", url: "https://okr.example.com/checkin/1" },
      { label: "Snooze", url: "https://okr.example.com/snooze/1" },
    ],
    templateKey: "checkin_due",
  };

  it("keeps everything for a provider that takes everything", () => {
    const built = buildMessage(draft, "slack");
    expect(built.blocks).toHaveLength(1);
    expect(built.buttons).toHaveLength(2);
    expect(built.degraded).toEqual([]);
  });

  it("drops the blocks and says so for a provider without rich cards", () => {
    const built = buildMessage(draft, "telegram");
    expect(built.blocks).toBeUndefined();
    expect(built.buttons).toHaveLength(2);
    expect(built.degraded.join()).toMatch(/no rich cards/);
  });

  it("appends the buttons as links where there are no buttons at all", () => {
    const built = buildMessage(draft, "whatsapp");
    expect(built.buttons).toBeUndefined();
    expect(built.text).toContain("Check in: https://okr.example.com/checkin/1");
    expect(built.degraded.join()).toMatch(/no buttons/);
  });

  it("sends the approved template outside a template-only window, and not the body", () => {
    const built = buildMessage(draft, "whatsapp", {
      insideConversationWindow: false,
    });
    expect(built.templateKey).toBe("checkin_due");
    expect(built.text).toBe("");
    expect(built.degraded.join()).toMatch(/conversation window/);
  });

  it("says plainly when there is no template to send outside the window", () => {
    const { templateKey: _templateKey, ...noTemplate } = draft;
    const built = buildMessage(noTemplate, "whatsapp", {
      insideConversationWindow: false,
    });
    expect(built.text).toBe("");
    expect(built.templateKey).toBeUndefined();
    expect(built.degraded.join()).toMatch(/none/);
  });

  it("never raises, whatever the provider cannot do", () => {
    // §5.2's rule: no driver refuses a message it cannot render.
    for (const provider of Object.keys(CHANNEL_CAPABILITIES) as Array<
      keyof typeof CHANNEL_CAPABILITIES
    >) {
      expect(() => buildMessage(draft, provider)).not.toThrow();
      expect(() =>
        buildMessage(draft, provider, { insideConversationWindow: false }),
      ).not.toThrow();
    }
  });

  it("leaves a message with no buttons alone", () => {
    expect(withLinkedButtons({ text: "Just this." })).toBe("Just this.");
  });
});
