import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countVariables,
  templateBody,
  verifySubscription,
  WhatsAppChannel,
  WhatsAppPermanentError,
  whatsAppBusinessAccountId,
  whatsAppDeliveryId,
  whatsAppPhoneNumberId,
} from "../src/drivers/channel/whatsapp.ts";

/**
 * The WhatsApp driver (P5-T04a).
 *
 * Meta's signature scheme is fully specified, so a body this test forges is
 * refused for exactly the reason a forged one would be refused in production.
 * The outbound calls go through a stubbed fetch: what is proved is the body sent
 * and the answer read, not that Meta accepts it, which needs a Business account
 * and is recorded on the task's row.
 */

const PHONE_NUMBER_ID = "123456789012345";
const APP_SECRET = "an-app-secret-nobody-should-see";
const TOKEN = "a-permanent-token-nobody-should-see";

interface Call {
  readonly url: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}

let calls: Call[] = [];
let answer: { status: number; body: unknown };

const stubFetch: typeof globalThis.fetch = async (input, init) => {
  calls.push({
    url: String(input),
    body: typeof init?.body === "string" ? init.body : "",
    headers: (init?.headers ?? {}) as Record<string, string>,
  });
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "content-type": "application/json" },
  });
};

const driver = (over: Record<string, unknown> = {}) =>
  new WhatsAppChannel({
    phoneNumberId: PHONE_NUMBER_ID,
    accessToken: TOKEN,
    appSecret: APP_SECRET,
    numberFor: () => null,
    fetch: stubFetch,
    ...over,
  });

/** A webhook body in the shape Meta sends one. */
const webhook = (message: Record<string, unknown> | null): string =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: PHONE_NUMBER_ID,
              },
              ...(message
                ? { messages: [message] }
                : { statuses: [{ id: "wamid.1", status: "delivered" }] }),
            },
          },
        ],
      },
    ],
  });

const textMessage = (body: string) => ({
  from: "628123456789",
  id: "wamid.abc",
  timestamp: "1756000000",
  type: "text",
  text: { body },
});

const signed = (rawBody: string, secret = APP_SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { messages: [{ id: "wamid.sent" }] } };
});

describe("sending", () => {
  it("posts a text message to the business number's endpoint", async () => {
    const result = await driver().sendToChannel("628123456789", {
      text: "Your check-in is due.",
    });

    expect(result.delivered).toBe(true);
    expect(result.externalMessageId).toBe("wamid.sent");

    const call = calls[0] as Call;
    expect(call.url).toBe(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    );
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(call.body)).toEqual({
      messaging_product: "whatsapp",
      to: "628123456789",
      type: "text",
      text: { body: "Your check-in is due.", preview_url: true },
    });
  });

  it("sends the approved template when the caller asked for one", async () => {
    // The window itself is P5-T04b. What this proves is that the driver can
    // carry a template at all, and that it never sends both.
    await driver().sendToChannel("628123456789", {
      text: "Your check-in is due.",
      templateKey: "checkin_due",
    });

    expect(JSON.parse((calls[0] as Call).body)).toEqual({
      messaging_product: "whatsapp",
      to: "628123456789",
      type: "template",
      template: { name: "checkin_due", language: { code: "en" } },
    });
  });

  it("sends a template in the language the connection chose", async () => {
    await driver({ templateLanguage: "id" }).sendToChannel("628123456789", {
      text: "x",
      templateKey: "checkin_due",
    });
    const body = JSON.parse((calls[0] as Call).body) as {
      template: { language: { code: string } };
    };
    expect(body.template.language.code).toBe("id");
  });

  it("suppresses for a member with no linked number", async () => {
    const result = await driver().send({ memberId: "m1" }, { text: "hello" });
    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toContain("no linked WhatsApp number");
    expect(calls).toHaveLength(0);
  });

  it("suppresses an empty message rather than letting Meta refuse it", async () => {
    const result = await driver().sendToChannel("628123456789", { text: "  " });
    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toBe("there was nothing to send");
    expect(calls).toHaveLength(0);
  });

  it("dead-letters what retrying cannot fix, and retries what it can", async () => {
    answer = {
      status: 400,
      body: {
        error: {
          message:
            "Message failed to send because more than 24 hours have passed",
          code: 131_047,
        },
      },
    };
    await expect(
      driver().sendToChannel("628123456789", { text: "hello" }),
    ).rejects.toBeInstanceOf(WhatsAppPermanentError);

    answer = {
      status: 429,
      body: { error: { message: "Too many calls", code: 4 } },
    };
    const retryable = driver().sendToChannel("628123456789", { text: "hello" });
    await expect(retryable).rejects.toThrow(/Too many calls/);
    await expect(retryable).rejects.not.toBeInstanceOf(WhatsAppPermanentError);
  });

  it("never puts a credential in an error", async () => {
    answer = {
      status: 401,
      body: { error: { message: "Invalid OAuth access token", code: 190 } },
    };
    const error = await driver()
      .sendToChannel("628123456789", { text: "hello" })
      .catch((thrown: Error) => thrown);
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain(APP_SECRET);
  });
});

describe("verifying an inbound body", () => {
  it("accepts a body Meta signed", async () => {
    const body = webhook(textMessage("status g-1"));
    expect(
      await driver().verifyInbound({
        headers: { "x-hub-signature-256": signed(body) },
        rawBody: body,
      }),
    ).toBe(true);
  });

  it("refuses a body signed with the wrong secret", async () => {
    const body = webhook(textMessage("status g-1"));
    expect(
      await driver().verifyInbound({
        headers: { "x-hub-signature-256": signed(body, "not-the-secret") },
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("refuses a body that was changed after it was signed", async () => {
    const body = webhook(textMessage("status g-1"));
    const signature = signed(body);
    expect(
      await driver().verifyInbound({
        headers: { "x-hub-signature-256": signature },
        rawBody: body.replace("status g-1", "resolve everything"),
      }),
    ).toBe(false);
  });

  it("refuses a header of the wrong shape rather than crashing on it", async () => {
    const body = webhook(textMessage("hello"));
    for (const header of ["", "sha256=", "nonsense", "sha1=abc"]) {
      expect(
        await driver().verifyInbound({
          headers: { "x-hub-signature-256": header },
          rawBody: body,
        }),
      ).toBe(false);
    }
    // No header at all.
    expect(await driver().verifyInbound({ headers: {}, rawBody: body })).toBe(
      false,
    );
  });

  it("refuses everything when no app secret is configured", async () => {
    const body = webhook(textMessage("hello"));
    expect(
      await driver({ appSecret: "" }).verifyInbound({
        headers: { "x-hub-signature-256": signed(body, "") },
        rawBody: body,
      }),
    ).toBe(false);
  });
});

describe("the subscription handshake", () => {
  const parameters = (over: Record<string, string> = {}) =>
    new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "the-token-the-admin-chose",
      "hub.challenge": "1158201444",
      ...over,
    });

  it("echoes the challenge when the token is right", () => {
    expect(verifySubscription(parameters(), "the-token-the-admin-chose")).toBe(
      "1158201444",
    );
  });

  it("says nothing for the wrong token, whatever its length", () => {
    expect(
      verifySubscription(parameters(), "another-token-entirely"),
    ).toBeNull();
    expect(
      verifySubscription(
        parameters({ "hub.verify_token": "short" }),
        "the-token-the-admin-chose",
      ),
    ).toBeNull();
  });

  it("says nothing for a mode it was not asked for", () => {
    expect(
      verifySubscription(
        parameters({ "hub.mode": "unsubscribe" }),
        "the-token-the-admin-chose",
      ),
    ).toBeNull();
  });

  it("says nothing when no token is configured at all", () => {
    // Otherwise an instance with no token would echo any challenge, which
    // confirms the endpoint exists to anybody who guessed the URL.
    expect(verifySubscription(parameters(), "")).toBeNull();
  });
});

describe("reading an inbound body", () => {
  it("takes the number as the sender, because that is what a reply reaches", async () => {
    const parsed = await driver().parseInbound(
      webhook(textMessage("status g-1")),
    );
    expect(parsed).toEqual({
      provider: "whatsapp",
      externalSenderId: "628123456789",
      text: "status g-1",
      externalMessageId: "wamid.abc",
    });
  });

  it("reads a reply button's id, which is the command it was sent with", async () => {
    const parsed = await driver().parseInbound(
      webhook({
        from: "628123456789",
        id: "wamid.def",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "resolve abc", title: "Resolve" },
        },
      }),
    );
    expect(parsed?.text).toBe("resolve abc");
  });

  it("ignores everything that is not somebody saying something", async () => {
    // A delivery receipt, an image, and a body that is not a webhook at all.
    expect(await driver().parseInbound(webhook(null))).toBeNull();
    expect(
      await driver().parseInbound(
        webhook({
          from: "628123456789",
          id: "wamid.x",
          type: "image",
          image: {},
        }),
      ),
    ).toBeNull();
    expect(await driver().parseInbound("not json")).toBeNull();
    expect(await driver().parseInbound("{}")).toBeNull();
  });
});

describe("listing the templates Meta holds (P5-T04b-a)", () => {
  const metaTemplate = (over: Record<string, unknown> = {}) => ({
    id: "meta-1",
    name: "checkin_due",
    language: "en",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      { type: "HEADER", text: "OpenOKR" },
      { type: "BODY", text: "Hi {{1}}, your check-in for {{2}} is due." },
      { type: "FOOTER", text: "Reply STOP to opt out" },
    ],
    ...over,
  });

  it("asks the business account, with the token, and reads the list", async () => {
    answer = { status: 200, body: { data: [metaTemplate()] } };
    const found = await driver().listTemplates("waba-1");

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("checkin_due");
    const call = calls[0] as Call;
    expect(call.url).toBe(
      "https://graph.facebook.com/v21.0/waba-1/message_templates?limit=100",
    );
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("follows Meta's paging rather than seeing the first page only", async () => {
    let page = 0;
    const paging: typeof globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : "",
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      page += 1;
      return Response.json(
        page === 1
          ? {
              data: [metaTemplate()],
              paging: { next: "https://graph.facebook.com/v21.0/next-page" },
            }
          : { data: [metaTemplate({ id: "meta-2", name: "blocker_open" })] },
      );
    };

    const found = await driver({ fetch: paging }).listTemplates("waba-1");
    expect(found.map((one) => one.name)).toEqual([
      "checkin_due",
      "blocker_open",
    ]);
  });

  it("stops rather than following a cursor that never ends", async () => {
    const endless: typeof globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : "",
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return Response.json({
        data: [metaTemplate()],
        paging: { next: "https://graph.facebook.com/v21.0/forever" },
      });
    };

    // A loop this process would not come back from is worse than a truncated
    // list somebody can see is truncated.
    const found = await driver({ fetch: endless }).listTemplates("waba-1");
    expect(found).toHaveLength(20);
  });

  it("dead-letters a token the app no longer holds", async () => {
    answer = {
      status: 401,
      body: { error: { message: "Invalid OAuth access token", code: 190 } },
    };
    await expect(driver().listTemplates("waba-1")).rejects.toBeInstanceOf(
      WhatsAppPermanentError,
    );
  });

  it("reads the body component, and not the header or the footer", () => {
    expect(templateBody(metaTemplate())).toBe(
      "Hi {{1}}, your check-in for {{2}} is due.",
    );
    expect(
      templateBody({ components: [{ type: "HEADER", text: "x" }] }),
    ).toBeNull();
    expect(templateBody({})).toBeNull();
  });

  it("counts the highest placeholder, not how many times one appears", () => {
    // Meta numbers from one with no gaps, and a body that says {{1}} twice
    // still takes one parameter.
    expect(countVariables("Hi {{1}}, thanks {{1}}.")).toBe(1);
    expect(countVariables("Hi {{1}}, your {{2}} is due.")).toBe(2);
    expect(countVariables("Nothing here")).toBe(0);
    expect(countVariables(null)).toBe(0);
    // Whitespace inside the braces is legal and means the same thing.
    expect(countVariables("Hi {{ 3 }}")).toBe(3);
  });

  it("finds the business account on a webhook, where Meta puts it", () => {
    expect(whatsAppBusinessAccountId(webhook(textMessage("hi")))).toBe(
      "business-1",
    );
    expect(whatsAppBusinessAccountId("{}")).toBeNull();
    expect(whatsAppBusinessAccountId("nonsense")).toBeNull();
  });
});

describe("what the endpoint reads before the driver does", () => {
  it("finds the delivery id, for the duplicate check", () => {
    expect(whatsAppDeliveryId(webhook(textMessage("hi")))).toBe("wamid.abc");
    // A status callback has nothing worth deduplicating.
    expect(whatsAppDeliveryId(webhook(null))).toBeNull();
    expect(whatsAppDeliveryId("nonsense")).toBeNull();
  });

  it("finds the business number, which is what names the workspace", () => {
    expect(whatsAppPhoneNumberId(webhook(textMessage("hi")))).toBe(
      PHONE_NUMBER_ID,
    );
    expect(whatsAppPhoneNumberId("{}")).toBeNull();
  });
});

describe("what it says it can do", () => {
  it("reports no buttons and a template window", () => {
    expect(driver().capabilities()).toEqual({
      outbound: true,
      inbound: true,
      richCards: false,
      buttons: false,
      threads: false,
      templateOnlyOutbound: true,
    });
  });
});
