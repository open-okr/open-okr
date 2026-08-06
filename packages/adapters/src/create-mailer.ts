/**
 * The mailer composition seam (P1-T09).
 *
 * A per-port factory beside `createAdapters`, because mail is the one
 * capability whose configuration lives in the database (the §4.14 instance
 * settings) rather than the environment alone. The host resolves those
 * settings and hands the result here; drivers stay private to this package.
 *
 * Kept apart from `createAdapters` on purpose: that builds the whole driver
 * set for a process, including a job queue, and a caller that only needs to
 * send one reset email should not stand all of that up.
 */
import { ConsoleMailer } from "./drivers/mail/console.ts";
import { SmtpMailer } from "./drivers/mail/smtp.ts";
import type { Mailer } from "./ports/mail.ts";

export type MailerConfig =
  | { readonly transport: "console" }
  | {
      readonly transport: "smtp";
      readonly host: string;
      readonly port: number;
      readonly secure: boolean;
      readonly from: string;
      readonly user?: string;
      readonly password?: string;
    };

export function createMailer(config: MailerConfig): Mailer {
  if (config.transport === "console") {
    return new ConsoleMailer();
  }

  if (config.host.trim() === "") {
    // A misconfiguration should read as one, not as a connection error to an
    // empty hostname ten seconds later.
    throw new Error(
      "Mail transport is 'smtp' but no host is configured. Set mail.host, or " +
        "set the transport back to 'console'.",
    );
  }

  return new SmtpMailer({
    host: config.host,
    port: config.port,
    secure: config.secure,
    from: config.from,
    ...(config.user ? { user: config.user } : {}),
    ...(config.password !== undefined ? { password: config.password } : {}),
  });
}
