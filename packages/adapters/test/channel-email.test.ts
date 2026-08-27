import { describe, expect, it } from "vitest";
import { EmailChannel, renderEmailBody } from "../src/drivers/channel/email.ts";
import { ConsoleMailer } from "../src/drivers/mail/console.ts";
import type { ChannelMessage } from "../src/ports/channel.ts";

/**
 * The email channel driver (P5-T01b-a).
 *
 * The rule this file holds is AI-NATIVE-PLAN §5.2's: no driver refuses a
 * message it cannot render. Email has no rich cards and no threads, and every
 * message still arrives.
 */

const mailerFor = () => {
  const lines: string[] = [];
  const mailer = new ConsoleMailer({ write: (line) => lines.push(line) });
  return { mailer, lines };
};

const message = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  text: "Your check-in is due.",
  ...over,
});

describe("what email can do", () => {
  it("reports buttons as a capability, because it keeps them as links", () => {
    const { mailer } = mailerFor();
    const channel = new EmailChannel({
      mailer,
      addressFor: () => "sam@example.com",
    });
    expect(channel.capabilities()).toEqual({
      outbound: true,
      inbound: false,
      richCards: false,
      buttons: true,
      threads: false,
      templateOnlyOutbound: false,
    });
  });

  it("nothing arrives this way", async () => {
    const { mailer } = mailerFor();
    const channel = new EmailChannel({
      mailer,
      addressFor: () => "sam@example.com",
    });
    expect(await channel.verifyInbound({ headers: {}, rawBody: "{}" })).toBe(
      false,
    );
    expect(await channel.parseInbound("{}")).toBeNull();
  });
});

describe("rendering", () => {
  it("leaves a plain message alone", () => {
    expect(renderEmailBody(message())).toBe("Your check-in is due.");
  });

  it("appends every button as a labelled link rather than dropping it", () => {
    expect(
      renderEmailBody(
        message({
          buttons: [
            { label: "Check in", url: "https://okr.example.com/checkin/1" },
            { label: "Snooze", url: "https://okr.example.com/snooze/1" },
          ],
        }),
      ),
    ).toBe(
      [
        "Your check-in is due.",
        "",
        "Check in: https://okr.example.com/checkin/1",
        "Snooze: https://okr.example.com/snooze/1",
      ].join("\n"),
    );
  });

  it("treats an empty button list as no buttons", () => {
    expect(renderEmailBody(message({ buttons: [] }))).toBe(
      "Your check-in is due.",
    );
  });
});

describe("sending", () => {
  it("sends to the address the lookup resolves", async () => {
    const { mailer } = mailerFor();
    const channel = new EmailChannel({
      mailer,
      addressFor: (recipient) =>
        recipient.memberId === "m-1" ? "sam@example.com" : null,
    });

    const result = await channel.send(
      { memberId: "m-1" },
      message({ subject: "Check in", idempotencyKey: "k-1" }),
    );

    expect(result.delivered).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("sam@example.com");
    expect(mailer.sent[0]?.subject).toBe("Check in");
    expect(mailer.sent[0]?.idempotencyKey).toBe("k-1");
  });

  it("suppresses rather than fails when the member has no address", async () => {
    const { mailer } = mailerFor();
    const channel = new EmailChannel({ mailer, addressFor: () => null });

    const result = await channel.send({ memberId: "m-1" }, message());

    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toMatch(/no email address/);
    expect(mailer.sent).toEqual([]);
  });

  it("falls back to a subject rather than sending one that is empty", async () => {
    const { mailer } = mailerFor();
    const channel = new EmailChannel({
      mailer,
      addressFor: () => "sam@example.com",
      defaultSubject: "OpenOKR",
    });
    await channel.send({ memberId: "m-1" }, message());
    expect(mailer.sent[0]?.subject).toBe("OpenOKR");
  });

  it("will not treat a space channel name as a mailbox", async () => {
    const { mailer } = mailerFor();
    const channel = new EmailChannel({
      mailer,
      addressFor: () => "sam@example.com",
    });

    const result = await channel.sendToChannel("#okr-team", message());

    expect(result.delivered).toBe(false);
    expect(mailer.sent).toEqual([]);
  });
});
