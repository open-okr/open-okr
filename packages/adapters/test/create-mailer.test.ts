import { describe, expect, it } from "vitest";
import { createMailer } from "../src/create-mailer.ts";
import { ConsoleMailer } from "../src/drivers/mail/console.ts";
import { SmtpMailer } from "../src/drivers/mail/smtp.ts";

/**
 * The mailer composition seam (P1-T09).
 *
 * This is what makes `OPENOKR_MAIL_*` real: the host resolves the mail
 * settings and this factory turns them into a driver. Without it the SMTP
 * driver existed but nothing could ever construct it, which made the
 * documented mail variables a lie.
 */

describe("createMailer", () => {
  it("builds the console driver by default, so a fresh install needs no server", () => {
    expect(createMailer({ transport: "console" })).toBeInstanceOf(
      ConsoleMailer,
    );
  });

  it("builds the SMTP driver when a transport is configured", () => {
    const mailer = createMailer({
      transport: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "okr@example.com",
    });
    expect(mailer).toBeInstanceOf(SmtpMailer);
  });

  it("refuses an SMTP transport without a host, rather than building a driver that cannot connect", () => {
    // 'smtp' with no host is a misconfiguration, and the operator should hear
    // about it as one, not as a connection error to an empty hostname.
    expect(() =>
      createMailer({
        transport: "smtp",
        host: "",
        port: 587,
        secure: false,
        from: "okr@example.com",
      }),
    ).toThrow(/host/i);
  });

  it("verifies the console driver as ok, because a working default is not a warning", async () => {
    const result = await createMailer({ transport: "console" }).verify();
    expect(result.ok).toBe(true);
  });
});
