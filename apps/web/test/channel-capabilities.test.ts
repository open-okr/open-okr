import {
  EmailChannel,
  SlackChannel,
  TeamsChannel,
  TelegramChannel,
} from "@openokr/adapters";
import { CHANNEL_CAPABILITIES } from "@openokr/core";
import { expect, test } from "vitest";

/**
 * The capability matrix has two homes, and this is what stops them drifting
 * (AI-NATIVE-PLAN.md §5.2, P5-T01b-b).
 *
 * `packages/core` holds the matrix as data, because the message builder runs on
 * the deterministic path and must work with no driver installed. Each driver in
 * `packages/adapters` reports its own row, because a driver is the thing that
 * actually knows what it can send. Neither package may import the other, so
 * nothing but a test can hold them together.
 *
 * `apps/web` is the one place that legitimately depends on both, which is why
 * this test lives here rather than beside either.
 */

test("the email driver reports what the core matrix says email can do", () => {
  const driver = new EmailChannel({
    // Never called: `capabilities()` reads no configuration.
    mailer: {
      send: async () => ({ messageId: "unused" }),
      verify: async () => ({ ok: true as const }),
      stop: async () => {},
    },
    addressFor: () => null,
  });

  expect(driver.capabilities()).toEqual(CHANNEL_CAPABILITIES.email);
});

test("the Slack driver reports what the core matrix says Slack can do", () => {
  const driver = new SlackChannel({
    botToken: "xoxb-unused",
    signingSecret: "unused",
    slackUserFor: () => null,
  });

  expect(driver.capabilities()).toEqual(CHANNEL_CAPABILITIES.slack);
});

test("the Teams driver reports what the core matrix says Teams can do", () => {
  const driver = new TeamsChannel({
    appId: "unused",
    appPassword: "unused",
    conversationFor: () => null,
  });

  expect(driver.capabilities()).toEqual(CHANNEL_CAPABILITIES.teams);
});

test("the Telegram driver reports what the core matrix says Telegram can do", () => {
  const driver = new TelegramChannel({
    botToken: "unused",
    webhookSecret: "unused",
    chatIdFor: () => null,
  });

  expect(driver.capabilities()).toEqual(CHANNEL_CAPABILITIES.telegram);
});

test("every provider the matrix names is one the router can choose", () => {
  // A row added to the matrix with no driver behind it is a channel the
  // product would route to and never deliver on. Named here so the next
  // provider task has to notice.
  expect(Object.keys(CHANNEL_CAPABILITIES).sort()).toEqual([
    "email",
    "slack",
    "teams",
    "telegram",
    "whatsapp",
  ]);
});
