/**
 * The SMTP mail driver (TECHNICAL-PLAN §5).
 *
 * nodemailer lives here and nowhere else, like every vendor SDK. The port is
 * what the rest of the product sees, so swapping this for a hosted mail API is
 * a driver change and nothing more.
 *
 * Two things this driver owes the first-run wizard:
 *
 *   1. `verify()` proves the settings before they are stored. An operator who
 *      mistypes a port should learn it in the wizard, not from the first
 *      invitation that never arrives.
 *   2. Every failure is a message an operator can act on, and never contains
 *      the password. nodemailer's errors quote the conversation, which can
 *      include the AUTH line, so failures are rewritten rather than passed
 *      through.
 */
import { createTransport, type Transporter } from "nodemailer";
import type { Mailer, MailMessage, SentMail } from "../../ports/mail.ts";

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS from the first byte. False means STARTTLS on 587. */
  readonly secure: boolean;
  readonly from: string;
  readonly user?: string;
  readonly password?: string;
  /**
   * Refuse to send over an unencrypted connection. On by default: a password
   * sent in the clear is worse than mail that does not go.
   */
  readonly requireTls?: boolean;
  /** Applied to connection, greeting and socket alike. */
  readonly timeoutMs?: number;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Turns an error into something safe to show.
 *
 * nodemailer attaches the SMTP conversation to its errors, and that
 * conversation can contain the base64 AUTH line. Only the code and a short
 * summary survive, and the summary is scrubbed of anything that looks like the
 * configured credentials.
 */
const safeMessage = (error: unknown, secrets: readonly string[]): string => {
  const raw =
    error instanceof Error
      ? `${(error as { code?: string }).code ?? error.name}: ${error.message}`
      : String(error);

  // Take the first line only: nodemailer's multi-line detail is the transcript.
  let message = raw.split("\n")[0] ?? raw;

  for (const secret of secrets) {
    if (secret === "") {
      continue;
    }
    if (message.includes(secret)) {
      message = message.replaceAll(secret, "[redacted]");
    }
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    if (message.includes(encoded)) {
      message = message.replaceAll(encoded, "[redacted]");
    }
  }

  return message;
};

export class SmtpMailer implements Mailer {
  readonly #transport: Transporter;
  readonly #from: string;
  readonly #secrets: readonly string[];

  constructor(options: SmtpOptions) {
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.#from = options.from;
    this.#secrets = options.password ? [options.password] : [];
    this.#transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      // requireTLS makes STARTTLS mandatory rather than opportunistic, so a
      // server that quietly declines to upgrade fails instead of sending the
      // credentials in the clear.
      requireTLS: options.requireTls ?? true,
      ...(options.user
        ? { auth: { user: options.user, pass: options.password ?? "" } }
        : {}),
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
  }

  /** Opens a connection and completes the handshake, sending nothing. */
  async verify(): Promise<VerifyResult> {
    try {
      await this.#transport.verify();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: safeMessage(error, this.#secrets) };
    }
  }

  async send(message: MailMessage): Promise<SentMail> {
    try {
      const info = await this.#transport.sendMail({
        from: this.#from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
      return { messageId: info.messageId };
    } catch (error) {
      // Rethrown rather than swallowed: the outbox relay decides what to retry,
      // and it cannot do that if a failed send looks like a success.
      throw new Error(`SMTP send failed. ${safeMessage(error, this.#secrets)}`);
    }
  }

  /** Releases pooled sockets. Called on process shutdown. */
  close(): void {
    this.#transport.close();
  }
}
