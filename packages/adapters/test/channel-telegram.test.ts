import { describe, expect, it } from "vitest";
import {
  TelegramChannel,
  TelegramPermanentError,
  telegramDeliveryId,
  toInlineKeyboard,
} from "../src/drivers/channel/telegram.ts";

/**
 * The Telegram driver (AI-NATIVE-PLAN.md §5 and §6, P5-T05).
 *
 * **Nothing here has ever spoken to Telegram.** Every outbound call goes through
 * a stubbed `fetch`, the same arrangement the Slack driver's tests have and for
 * the same reason: what can be proved is the request shape and the reading of
 * the answer, not that the provider accepts it.
 *
 * The tests worth reading are the ones where Telegram is *different* from
 * Slack, because those are where a driver written by copying would be wrong:
 * the token is in the URL, inbound is a shared secret rather than a signature,
 * and a button can only carry 64 bytes.
 */

const BOT_TOKEN = "123456:AAH-a-token-nobody-should-log";
const WEBHOOK_SECRET = "a-secret-only-telegram-was-told";

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

const channelFor = (
  answers: Record<string, unknown> = {},
  chatId: string | null = "555",
) => {
  const calls: Call[] = [];
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split("/").pop() ?? "";
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const answer = answers[method] ?? { ok: true, result: { message_id: 9 } };
    return {
      ok: true,
      status: 200,
      json: async () => answer,
    } as Response;
  }) as unknown as typeof globalThis.fetch;

  const channel = new TelegramChannel({
    botToken: BOT_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    chatIdFor: () => chatId,
    fetch: fetchStub,
  });
  return { channel, calls };
};

describe("what Telegram can do", () => {
  it("has no rich cards and does have buttons, which is the matrix's row", () => {
    const { channel } = channelFor();
    expect(channel.capabilities()).toEqual({
      outbound: true,
      inbound: true,
      richCards: false,
      buttons: true,
      threads: false,
      templateOnlyOutbound: false,
    });
  });
});

describe("the token is in the URL, which is why nothing logs one", () => {
  it("puts the bot token in the path rather than a header", async () => {
    const { channel, calls } = channelFor();
    await channel.send({ memberId: "m-1" }, { text: "Your check-in is due." });
    expect(calls[0]?.url).toContain(`/bot${BOT_TOKEN}/sendMessage`);
  });

  it("names the method and never the URL when the provider refuses", async () => {
    const { channel } = channelFor({
      sendMessage: {
        ok: false,
        error_code: 400,
        description: "Bad Request: something",
      },
    });
    const failure = await channel
      .send({ memberId: "m-1" }, { text: "Hello." })
      .then(
        () => new Error("expected a refusal"),
        (error: unknown) => error as Error,
      );

    expect(failure.message).toContain("sendMessage");
    // The URL holds a credential. A message that quoted it would put a bot
    // token in every log that catches this.
    expect(failure.message).not.toContain(BOT_TOKEN);
  });
});

describe("inbound is a shared secret, not a signature", () => {
  const body = JSON.stringify({ update_id: 1, message: { chat: { id: 555 } } });

  it("accepts the secret Telegram was given", async () => {
    const { channel } = channelFor();
    expect(
      await channel.verifyInbound({
        headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
        rawBody: body,
      }),
    ).toBe(true);
  });

  it("refuses a wrong secret", async () => {
    const { channel } = channelFor();
    expect(
      await channel.verifyInbound({
        headers: { "x-telegram-bot-api-secret-token": "not-it" },
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("refuses a secret of the wrong length instead of crashing on it", async () => {
    // `timingSafeEqual` throws on mismatched lengths, so without the length
    // check a forged short header would take the handler down.
    const { channel } = channelFor();
    await expect(
      channel.verifyInbound({
        headers: { "x-telegram-bot-api-secret-token": "x" },
        rawBody: body,
      }),
    ).resolves.toBe(false);
  });

  it("refuses a request with no secret header at all", async () => {
    const { channel } = channelFor();
    expect(await channel.verifyInbound({ headers: {}, rawBody: body })).toBe(
      false,
    );
  });

  it("refuses everything when the connection has no secret stored", async () => {
    // An empty stored secret must not match an empty header. A provider that
    // does not sign leaves this as the only check there is.
    const channel = new TelegramChannel({
      botToken: BOT_TOKEN,
      webhookSecret: "",
      chatIdFor: () => "555",
    });
    expect(
      await channel.verifyInbound({
        headers: { "x-telegram-bot-api-secret-token": "" },
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("does not care what the body says, because there is nothing to verify it against", async () => {
    // The structural difference from Slack, stated as a test: a tampered body
    // under a valid secret passes here and would fail there. Telegram provides
    // no signature, so this is the strongest claim available, and the endpoint
    // still refuses before parsing.
    const { channel } = channelFor();
    expect(
      await channel.verifyInbound({
        headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
        rawBody: '{"update_id":1,"message":{"chat":{"id":999}}}',
      }),
    ).toBe(true);
  });
});

describe("what arrives", () => {
  it("reads a typed message, by chat rather than by sender", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      JSON.stringify({
        update_id: 7,
        message: {
          message_id: 3,
          chat: { id: 555 },
          from: { id: 555 },
          text: "status g-1",
        },
      }),
    );
    // The chat is what a reply is addressed to, and for a direct message it
    // equals the sender.
    expect(parsed).toMatchObject({
      provider: "telegram",
      externalSenderId: "555",
      text: "status g-1",
      externalMessageId: "3",
    });
  });

  it("reads an inline button press as its own value", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      JSON.stringify({
        update_id: 8,
        callback_query: {
          data: "checkin g-1",
          message: { chat: { id: 555 } },
        },
      }),
    );
    expect(parsed).toMatchObject({
      externalSenderId: "555",
      text: "checkin g-1",
    });
  });

  it("returns null for an update it does not recognise", async () => {
    const { channel } = channelFor();
    expect(
      await channel.parseInbound(JSON.stringify({ update_id: 9 })),
    ).toBeNull();
    expect(await channel.parseInbound("not json")).toBeNull();
  });

  it("never decides what a command means", async () => {
    const { channel } = channelFor();
    const parsed = await channel.parseInbound(
      JSON.stringify({
        update_id: 10,
        message: { chat: { id: 555 }, text: "delete every goal" },
      }),
    );
    expect(parsed?.text).toBe("delete every goal");
  });
});

describe("delivery ids", () => {
  it("uses update_id, which repeats when Telegram retries", () => {
    expect(
      telegramDeliveryId(JSON.stringify({ update_id: 4242, message: {} })),
    ).toBe("4242");
  });

  it("says null rather than inventing one", () => {
    expect(telegramDeliveryId("{}")).toBeNull();
    expect(telegramDeliveryId("not json")).toBeNull();
  });
});

describe("the inline keyboard", () => {
  it("sends a link as a url button", () => {
    const keyboard = toInlineKeyboard({
      text: "Due",
      buttons: [{ label: "Open", url: "https://okr.example.com/goal/1" }],
    });
    expect(keyboard).toEqual({
      inline_keyboard: [
        [{ text: "Open", url: "https://okr.example.com/goal/1" }],
      ],
    });
  });

  it("sends a command as callback data, so pressing it runs it here", () => {
    const keyboard = toInlineKeyboard({
      text: "Due",
      buttons: [{ label: "Check in", url: "okr:checkin g-1" }],
    });
    expect(keyboard).toEqual({
      inline_keyboard: [[{ text: "Check in", callback_data: "checkin g-1" }]],
    });
  });

  it("drops a command too long to carry rather than truncating it", () => {
    // Telegram caps callback data at 64 bytes. Half a command is a command
    // that would run the wrong thing.
    const long = `checkin ${"g".repeat(80)}`;
    const keyboard = toInlineKeyboard({
      text: "Due",
      buttons: [{ label: "Check in", url: `okr:${long}` }],
    });
    expect(keyboard).toBeUndefined();
  });

  it("keeps the buttons that do fit when one does not", () => {
    const keyboard = toInlineKeyboard({
      text: "Due",
      buttons: [
        { label: "Too long", url: `okr:checkin ${"g".repeat(80)}` },
        { label: "Open", url: "https://okr.example.com/goal/1" },
      ],
    });
    expect(keyboard).toEqual({
      inline_keyboard: [
        [{ text: "Open", url: "https://okr.example.com/goal/1" }],
      ],
    });
  });

  it("is absent for a message with no buttons", () => {
    expect(toInlineKeyboard({ text: "Due" })).toBeUndefined();
  });
});

describe("sending", () => {
  it("addresses a person and a group the same way, with no conversation to open", async () => {
    const { channel, calls } = channelFor();
    await channel.send({ memberId: "m-1" }, { text: "Your check-in is due." });
    await channel.sendToChannel("-100999", { text: "This week's digest." });

    // One call each. Slack needs `conversations.open` first; Telegram does not,
    // which is the one place this driver is simpler rather than merely
    // different.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body.chat_id).toBe("555");
    expect(calls[1]?.body.chat_id).toBe("-100999");
  });

  it("prefers an external id the caller already resolved", async () => {
    const { channel, calls } = channelFor({}, null);
    await channel.send(
      { memberId: "m-1", externalId: "777" },
      { text: "Hello." },
    );
    expect(calls[0]?.body.chat_id).toBe("777");
  });

  it("suppresses rather than fails for a member with no linked account", async () => {
    const { channel, calls } = channelFor({}, null);
    const result = await channel.send({ memberId: "m-1" }, { text: "Hello." });
    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toMatch(/no linked Telegram account/);
    expect(calls).toEqual([]);
  });

  it("reports the message id it was given", async () => {
    const { channel } = channelFor({
      sendMessage: { ok: true, result: { message_id: 42 } },
    });
    const result = await channel.send({ memberId: "m-1" }, { text: "Hi." });
    expect(result).toEqual({ delivered: true, externalMessageId: "42" });
  });
});

describe("what Telegram refuses", () => {
  it("dead-letters a member who blocked the bot", async () => {
    const { channel } = channelFor({
      sendMessage: {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      },
    });
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toBeInstanceOf(TelegramPermanentError);
    // The relay matches on the name, so this has to carry it.
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });

  it("dead-letters a chat that no longer exists", async () => {
    const { channel } = channelFor({
      sendMessage: {
        ok: false,
        error_code: 400,
        description: "Bad Request: chat not found",
      },
    });
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toBeInstanceOf(TelegramPermanentError);
  });

  it("retries a rate limit, because that one goes away", async () => {
    const { channel } = channelFor({
      sendMessage: {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 30",
      },
    });
    const failure = await channel
      .send({ memberId: "m-1" }, { text: "Hello." })
      .then(
        () => new Error("expected a refusal"),
        (error: unknown) => error as Error,
      );
    expect(failure.name).not.toBe("PermanentDispatchError");
  });

  it("treats a server error as retryable", async () => {
    const fetchStub = (async () =>
      ({
        ok: false,
        status: 502,
        json: async () => ({}),
      }) as Response) as unknown as typeof globalThis.fetch;
    const channel = new TelegramChannel({
      botToken: BOT_TOKEN,
      webhookSecret: WEBHOOK_SECRET,
      chatIdFor: () => "555",
      fetch: fetchStub,
    });
    await expect(
      channel.send({ memberId: "m-1" }, { text: "Hello." }),
    ).rejects.toThrow(/HTTP 502/);
  });
});
