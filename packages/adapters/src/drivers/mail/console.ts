/**
 * The console mail driver: the default when no SMTP server is configured.
 *
 * It prints what it would have sent and keeps it in memory. That makes local
 * development and tests work with no mail server, and makes a misconfigured
 * production install obvious rather than silently dropping mail.
 */
import type {
  Mailer,
  MailMessage,
  MailVerifyResult,
  SentMail,
} from "../../ports/mail.ts";

export interface ConsoleMailerOptions {
  /** Where the rendered message goes. Defaults to standard output. */
  readonly write?: (line: string) => void;
}

export class ConsoleMailer implements Mailer {
  readonly #write: (line: string) => void;
  /** Every message this driver has "sent", for assertions in tests. */
  readonly sent: MailMessage[] = [];
  #counter = 0;

  constructor(options: ConsoleMailerOptions = {}) {
    this.#write =
      options.write ?? ((line) => process.stdout.write(`${line}\n`));
  }

  async verify(): Promise<MailVerifyResult> {
    // There is nothing to test: this driver has no server. It is a working
    // default, not a missing one, so it verifies rather than warns.
    return { ok: true };
  }

  async send(message: MailMessage): Promise<SentMail> {
    this.#counter++;
    const messageId = `console-${this.#counter}`;
    this.sent.push(message);

    this.#write(
      [
        "--- mail (console driver, nothing was sent) ---",
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "----------------------------------------------",
      ].join("\n"),
    );

    return { messageId };
  }

  async stop(): Promise<void> {
    // Nothing open: this driver never leaves the process.
  }
}
