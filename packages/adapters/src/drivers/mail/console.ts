/**
 * The console mail driver: the default when no SMTP server is configured.
 *
 * It prints what it would have sent and keeps it in memory. That makes local
 * development and tests work with no mail server, and makes a misconfigured
 * production install obvious rather than silently dropping mail.
 *
 * **Outside development it prints who and what, never the body**
 * (completeness review L-12). A body is where the password-reset link, the
 * address confirmation and the invitation token are, and each of those is a
 * credential: in a production log it is readable by whoever reads logs, and it
 * outlives the message. So a production instance on this driver logs the
 * masked recipient and the subject, which is enough to see that mail is being
 * attempted and going nowhere. A developer's own machine still prints the
 * whole message, because there the link in the log is how they sign in.
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
  /**
   * Whether the log shows the body and the full address. Defaults to true
   * only when `NODE_ENV` is not `production`.
   */
  readonly revealContent?: boolean;
}

/** `ada@example.com` as `a***@example.com`: which domain, not who. */
function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) {
    return "***";
  }
  return `${address[0]}***${address.slice(at)}`;
}

export class ConsoleMailer implements Mailer {
  readonly #write: (line: string) => void;
  readonly #reveal: boolean;
  /** Every message this driver has "sent", for assertions in tests. */
  readonly sent: MailMessage[] = [];
  #counter = 0;

  constructor(options: ConsoleMailerOptions = {}) {
    this.#write =
      options.write ?? ((line) => process.stdout.write(`${line}\n`));
    this.#reveal =
      options.revealContent ?? process.env.NODE_ENV !== "production";
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
        `to:      ${this.#reveal ? message.to : maskAddress(message.to)}`,
        `subject: ${message.subject}`,
        "",
        this.#reveal
          ? message.text
          : "(body withheld: it can carry a sign-in or invitation link. Set mail.transport to smtp to deliver mail.)",
        "----------------------------------------------",
      ].join("\n"),
    );

    return { messageId };
  }

  async stop(): Promise<void> {
    // Nothing open: this driver never leaves the process.
  }
}
