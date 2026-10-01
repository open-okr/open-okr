import { describe, expect, it } from "vitest";
import { ConsoleMailer } from "../src/drivers/mail/console.ts";

/**
 * What the console mail driver puts in a log (completeness review L-12).
 *
 * It is the default transport, so a production instance nobody configured
 * runs on it, and every reset link and invitation token it handled used to be
 * printed whole into the process log.
 */

const INVITATION = {
  to: "ada@example.com",
  subject: "You have been invited to OpenOKR",
  text: "Join here: https://okr.example.com/join/secret-token-123",
};

const captured = (revealContent: boolean | undefined) => {
  const lines: string[] = [];
  const mailer = new ConsoleMailer({
    write: (line) => lines.push(line),
    ...(revealContent === undefined ? {} : { revealContent }),
  });
  return { mailer, lines };
};

describe("the console mail driver's log", () => {
  it("holds back the body and the full address in production", async () => {
    const { mailer, lines } = captured(false);
    await mailer.send(INVITATION);
    const log = lines.join("\n");
    expect(log).not.toContain("secret-token-123");
    expect(log).not.toContain("ada@example.com");
    expect(log).toContain("a***@example.com");
    expect(log).toContain(INVITATION.subject);
    expect(log).toContain("body withheld");
  });

  it("prints the whole message on a developer's machine, where the link is how they sign in", async () => {
    const { mailer, lines } = captured(true);
    await mailer.send(INVITATION);
    const log = lines.join("\n");
    expect(log).toContain("secret-token-123");
    expect(log).toContain("ada@example.com");
  });

  it("decides by NODE_ENV when nobody says", async () => {
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const { mailer, lines } = captured(undefined);
      await mailer.send(INVITATION);
      expect(lines.join("\n")).not.toContain("secret-token-123");
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  it("still keeps the message for a test to read, whatever it logged", async () => {
    const { mailer } = captured(false);
    await mailer.send(INVITATION);
    expect(mailer.sent[0]?.text).toContain("secret-token-123");
  });
});
