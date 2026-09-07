import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkInView,
  parseViewSubmission,
  SlackChannel,
  SlackPermanentError,
  slackDeliveryId,
  toBlocks,
} from "../src/drivers/channel/slack.ts";

/**
 * The Slack driver (AI-NATIVE-PLAN.md §6, P5-T02a).
 *
 * **Nothing here has ever spoken to Slack.** Every outbound call goes through a
 * stubbed `fetch`, which is the honest shape of a test for a third-party API:
 * what can be proved is that the driver sends the right body to the right
 * method and reads the answer correctly. What cannot be proved here is that
 * Slack accepts it, and that is recorded on the task rather than implied by a
 * green suite.
 *
 * The signature tests are different: Slack's scheme is fully specified, so a
 * forged header is refused here for exactly the reason it would be refused in
 * production.
 */

const SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const NOW = 1_756_300_000_000;

const sign = (timestamp: string, body: string): string =>
  `v0=${createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;

const headersFor = (body: string, over: { timestamp?: string } = {}) => {
  const timestamp = over.timestamp ?? String(Math.floor(NOW / 1000));
  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": sign(timestamp, body),
  };
};

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly authorization: string | undefined;
}

const stub = (answers: Record<string, unknown>) => {
  const calls: Call[] = [];
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split("/").pop() ?? "";
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      authorization: (init?.headers as Record<string, string> | undefined)
        ?.authorization,
    });
    const answer = answers[method] ?? { ok: true };
    return {
      ok: true,
      status: 200,
      json: async () => answer,
    } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchStub };
};

const channelFor = (
  answers: Record<string, unknown> = {},
  slackUser: string | null = "U-sam",
) => {
  const { calls, fetchStub } = stub(answers);
  const channel = new SlackChannel({
    botToken: "xoxb-test",
    signingSecret: SIGNING_SECRET,
    slackUserFor: () => slackUser,
    fetch: fetchStub,
    now: () => NOW,
  });
  return { channel, calls };
};

describe("what Slack can do", () => {
  it("reports every capability the matrix gives it", () => {
    const { channel } = channelFor();
    expect(channel.capabilities()).toEqual({
      outbound: true,
      inbound: true,
      richCards: true,
      buttons: true,
      threads: true,
      templateOnlyOutbound: false,
    });
  });
});

describe("inbound verification, before anything is parsed", () => {
  const body = '{"event":{"user":"U-sam","text":"status"}}';

  it("accepts a payload Slack actually signed", async () => {
    const { channel } = channelFor();
    expect(
      await channel.verifyInbound({ headers: headersFor(body), rawBody: body }),
    ).toBe(true);
  });

  it("refuses a tampered body under a real signature", async () => {
    const { channel } = channelFor();
    const headers = headersFor(body);
    expect(
      await channel.verifyInbound({
        headers,
        rawBody: '{"event":{"user":"U-attacker","text":"status"}}',
      }),
    ).toBe(false);
  });

  it("refuses a tampered signature under a real body", async () => {
    const { channel } = channelFor();
    const headers = headersFor(body);
    expect(
      await channel.verifyInbound({
        headers: {
          ...headers,
          "x-slack-signature": `${"v0="}${"0".repeat(64)}`,
        },
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("refuses a signature of the wrong length instead of crashing on it", async () => {
    // `timingSafeEqual` throws on mismatched lengths, so without the length
    // check in front of it a forged short header would take the handler down
    // rather than being refused.
    const { channel } = channelFor();
    await expect(
      channel.verifyInbound({
        headers: {
          ...headersFor(body),
          "x-slack-signature": "v0=short",
        },
        rawBody: body,
      }),
    ).resolves.toBe(false);
  });

  it("refuses a replay from outside the window", async () => {
    const { channel } = channelFor();
    const old = String(Math.floor(NOW / 1000) - 301);
    expect(
      await channel.verifyInbound({
        headers: {
          "x-slack-request-timestamp": old,
          "x-slack-signature": sign(old, body),
        },
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("accepts one just inside the window, in either direction", async () => {
    const { channel } = channelFor();
    for (const offset of [-299, 299]) {
      const stamp = String(Math.floor(NOW / 1000) + offset);
      expect(
        await channel.verifyInbound({
          headers: {
            "x-slack-request-timestamp": stamp,
            "x-slack-signature": sign(stamp, body),
          },
          rawBody: body,
        }),
      ).toBe(true);
    }
  });

  it("refuses a request with no signature headers at all", async () => {
    const { channel } = channelFor();
    expect(await channel.verifyInbound({ headers: {}, rawBody: body })).toBe(
      false,
    );
  });
});

describe("what arrives", () => {
  it("reads an event callback", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      JSON.stringify({
        event: {
          user: "U-sam",
          text: "check in",
          ts: "1756.1",
          thread_ts: "1755.9",
        },
      }),
    );
    expect(parsed).toMatchObject({
      provider: "slack",
      externalSenderId: "U-sam",
      text: "check in",
      threadKey: "1755.9",
    });
  });

  it("reads a slash command", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      "user_id=U-sam&command=%2Fokr&text=status",
    );
    expect(parsed).toMatchObject({
      externalSenderId: "U-sam",
      text: "/okr status",
    });
  });

  it("reads a button press as its own value", async () => {
    const { channel } = channelFor();
    const payload = JSON.stringify({
      type: "block_actions",
      user: { id: "U-sam" },
      actions: [{ value: "checkin:goal-1" }],
    });
    const parsed = await channel.parseInbound(
      `payload=${encodeURIComponent(payload)}`,
    );
    expect(parsed).toMatchObject({
      externalSenderId: "U-sam",
      text: "checkin:goal-1",
    });
  });

  it("returns null for something it does not recognise", async () => {
    const { channel } = channelFor();
    expect(await channel.parseInbound("nothing=useful")).toBeNull();
    expect(await channel.parseInbound("")).toBeNull();
  });

  it("never decides what a command means", async () => {
    // §7 puts that in one router generated from the registry. A driver that
    // interpreted commands would be the fourth copy of it by the time the
    // other three providers land.
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      "user_id=U-sam&command=%2Fokr&text=rm+-rf+everything",
    );
    // The text comes through as text. Nothing is executed and nothing is
    // resolved to an action here.
    expect(parsed?.text).toBe("/okr rm -rf everything");
  });
});

describe("delivery ids, for the duplicate check", () => {
  it("uses Slack's own event id, which repeats across its retries", () => {
    expect(
      slackDeliveryId({
        headers: { "x-slack-retry-num": "2" },
        rawBody: JSON.stringify({ event_id: "Ev123", event: {} }),
      }),
    ).toBe("Ev123");
  });

  it("falls back to the signature, which is a function of the exact body", () => {
    const body = "user_id=U-sam";
    const headers = headersFor(body);
    expect(slackDeliveryId({ headers, rawBody: body })).toBe(
      headers["x-slack-signature"],
    );
  });

  it("says null rather than inventing one", () => {
    expect(
      slackDeliveryId({ headers: {}, rawBody: "user_id=U-sam" }),
    ).toBeNull();
  });
});

describe("Block Kit", () => {
  it("keeps the text alongside the blocks, for a client that cannot render them", () => {
    const blocks = toBlocks({ text: "Your check-in is due." });
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "Your check-in is due." },
    });
  });

  it("renders buttons as an actions block", () => {
    const blocks = toBlocks({
      text: "Your check-in is due.",
      buttons: [
        { label: "Check in", url: "https://okr.example.com/checkin/1" },
        { label: "Snooze", url: "https://okr.example.com/snooze/1" },
      ],
    });
    const actions = blocks.find((block) => block.type === "actions");
    expect(actions).toBeDefined();
    expect((actions?.elements as unknown[]) ?? []).toHaveLength(2);
  });

  it("caps at five buttons, which is Slack's own limit", () => {
    const blocks = toBlocks({
      text: "Many",
      buttons: Array.from({ length: 8 }, (_unused, index) => ({
        label: `Button ${index}`,
        url: `https://okr.example.com/${index}`,
      })),
    });
    const actions = blocks.find((block) => block.type === "actions");
    expect((actions?.elements as unknown[]) ?? []).toHaveLength(5);
  });
});

describe("sending", () => {
  it("opens the conversation before posting, because a bot posts to a channel and not to a user", async () => {
    const { channel, calls } = channelFor({
      "conversations.open": { ok: true, channel: { id: "D-sam" } },
      "chat.postMessage": { ok: true, ts: "1756.5" },
    });

    const result = await channel.send(
      { memberId: "m-1" },
      { text: "Your check-in is due." },
    );

    expect(result).toEqual({ delivered: true, externalMessageId: "1756.5" });
    expect(calls.map((call) => call.url.split("/").pop())).toEqual([
      "conversations.open",
      "chat.postMessage",
    ]);
    expect(calls[1]?.body.channel).toBe("D-sam");
    expect(calls[0]?.authorization).toBe("Bearer xoxb-test");
  });

  it("prefers an external id the caller already resolved", async () => {
    const { channel, calls } = channelFor({
      "conversations.open": { ok: true, channel: { id: "D-sam" } },
    });
    await channel.send(
      { memberId: "m-1", externalId: "U-given" },
      { text: "Hello." },
    );
    expect(calls[0]?.body.users).toBe("U-given");
  });

  it("suppresses rather than fails for a member with no linked account", async () => {
    const { channel, calls } = channelFor({}, null);
    const result = await channel.send({ memberId: "m-1" }, { text: "Hello." });
    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toMatch(/no linked Slack account/);
    expect(calls).toEqual([]);
  });

  it("posts straight to a space channel without opening anything", async () => {
    const { channel, calls } = channelFor({
      "chat.postMessage": { ok: true, ts: "1756.6" },
    });
    await channel.sendToChannel("C-team", { text: "This week's digest." });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.channel).toBe("C-team");
  });

  it("threads a reply when the message names a thread", async () => {
    const { channel, calls } = channelFor({
      "chat.postMessage": { ok: true },
    });
    await channel.sendToChannel("C-team", {
      text: "A reply.",
      threadKey: "1755.9",
    });
    expect(calls[0]?.body.thread_ts).toBe("1755.9");
  });
});

describe("what Slack refuses", () => {
  it("dead-letters a deactivated account rather than retrying it for an hour", async () => {
    const { channel } = channelFor({
      "conversations.open": { ok: false, error: "account_inactive" },
    });
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toBeInstanceOf(SlackPermanentError);
    // The relay matches on the name, so this has to carry it.
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });

  it("retries a rate limit, because that one goes away", async () => {
    const { channel } = channelFor({
      "conversations.open": { ok: false, error: "ratelimited" },
    });
    const failure = await channel
      .send({ memberId: "m-1" }, { text: "Hello." })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).not.toBe("PermanentDispatchError");
  });

  it("treats an HTTP failure as retryable", async () => {
    const fetchStub = (async () =>
      ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }) as Response) as unknown as typeof globalThis.fetch;
    const channel = new SlackChannel({
      botToken: "xoxb-test",
      signingSecret: SIGNING_SECRET,
      slackUserFor: () => "U-sam",
      fetch: fetchStub,
      now: () => NOW,
    });
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("the modal", () => {
  it("carries the goal in private_metadata, because Slack hands the view back with no memory", () => {
    const view = checkInView({
      goalId: "g-1",
      goalTitle: "Grow enterprise",
      statuses: ["on_track", "caution", "off_track"],
    });
    expect(view.private_metadata).toBe("g-1");
    expect(view.callback_id).toBe("openokr_check_in");
  });

  it("asks the same three questions the conversation asks", () => {
    const view = checkInView({
      goalId: "g-1",
      goalTitle: "Grow enterprise",
      statuses: ["on_track"],
    });
    const blocks = view.blocks as Array<Record<string, unknown>>;
    expect(
      blocks.filter((block) => block.type === "input").map((b) => b.block_id),
    ).toEqual(["status", "confidence", "narrative"]);
  });

  it("opens through views.open with the trigger", async () => {
    const { channel, calls } = channelFor({ "views.open": { ok: true } });
    await channel.openView("T-123", { type: "modal" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.trigger_id).toBe("T-123");
  });
});

describe("reading a submitted form", () => {
  const submission = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "view_submission",
      user: { id: "U-sam" },
      view: {
        private_metadata: "g-1",
        state: {
          values: {
            status: { value: { selected_option: { value: "on_track" } } },
            confidence: { value: { value: "8" } },
            narrative: { value: { value: "Two renewals landed." } },
          },
        },
      },
      ...over,
    });

  it("flattens Slack's tree into one answer per field", () => {
    const parsed = parseViewSubmission(
      `payload=${encodeURIComponent(submission())}`,
    );
    expect(parsed).toEqual({
      provider: "slack",
      externalSenderId: "U-sam",
      reference: "g-1",
      fields: {
        status: "on_track",
        confidence: "8",
        narrative: "Two renewals landed.",
      },
    });
  });

  it("reads a select and a text input, which store their value in different keys", () => {
    // A select puts it under `selected_option.value` and a text input under
    // `value`. Handling only one of the two is how a form silently loses a
    // field.
    const parsed = parseViewSubmission(
      `payload=${encodeURIComponent(submission())}`,
    );
    expect(parsed?.fields.status).toBe("on_track");
    expect(parsed?.fields.confidence).toBe("8");
  });

  it("is null for anything that is not a submission", () => {
    expect(parseViewSubmission("user_id=U-sam&command=%2Fokr")).toBeNull();
    expect(
      parseViewSubmission(
        `payload=${encodeURIComponent(
          JSON.stringify({ type: "block_actions", user: { id: "U-sam" } }),
        )}`,
      ),
    ).toBeNull();
    expect(parseViewSubmission("")).toBeNull();
  });
});

describe("buttons that run a command", () => {
  it("becomes a Slack action rather than a link", () => {
    const blocks = toBlocks({
      text: "Your check-in is due.",
      buttons: [{ label: "Check in", url: "okr:checkin g-1" }],
    });
    const actions = blocks.find((block) => block.type === "actions");
    const elements = (actions?.elements ?? []) as Array<
      Record<string, unknown>
    >;
    const element = elements[0];
    expect(element?.value).toBe("checkin g-1");
    // A value, not a url: `okr:checkin g-1` is not a place a browser can go.
    expect(element?.url).toBeUndefined();
  });

  it("leaves a real link a link", () => {
    const blocks = toBlocks({
      text: "Your check-in is due.",
      buttons: [{ label: "Open", url: "https://okr.example.com/goal/1" }],
    });
    const actions = blocks.find((block) => block.type === "actions");
    const elements = (actions?.elements ?? []) as Array<
      Record<string, unknown>
    >;
    const element = elements[0];
    expect(element?.url).toBe("https://okr.example.com/goal/1");
    expect(element?.value).toBeUndefined();
  });
});

describe("the trigger a form needs", () => {
  it("comes through on a slash command", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      "user_id=U-sam&command=%2Fokr&text=checkin+g-1&trigger_id=T-999",
    );
    expect(parsed?.triggerId).toBe("T-999");
  });

  it("comes through on a button press", async () => {
    const { channel } = channelFor();
    const payload = JSON.stringify({
      type: "block_actions",
      user: { id: "U-sam" },
      trigger_id: "T-888",
      actions: [{ value: "checkin g-1" }],
    });
    const parsed = await channel.parseInbound(
      `payload=${encodeURIComponent(payload)}`,
    );
    expect(parsed?.triggerId).toBe("T-888");
  });

  it("is absent when the provider did not send one, which is what makes the conversation the fallback", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      JSON.stringify({ event: { user: "U-sam", text: "checkin g-1" } }),
    );
    expect(parsed?.triggerId).toBeUndefined();
  });
});
