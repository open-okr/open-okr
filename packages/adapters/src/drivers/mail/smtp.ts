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
import type {
  Mailer,
  MailMessage,
  MailVerifyResult,
  SentMail,
} from "../../ports/mail.ts";

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

const DEFAULT_TIMEOUT_MS = 10_000;

const REDACTED = "[redacted]";

/** A base64 run long enough to hide a credential. */
const BASE64_RUN = /[A-Za-z0-9+/]{8,}={0,2}/g;

/**
 * Every spelling of the credentials that can appear in an SMTP transcript.
 *
 * Redacting the password and `base64(password)` was not enough. AUTH PLAIN
 * sends `base64(authzid NUL authcid NUL passwd)` and AUTH LOGIN sends the
 * username and password as separate base64 lines, and none of those contains
 * `base64(password)` as a substring. A server that quotes the rejected AUTH
 * line back therefore put the password on the operator's screen.
 */
const credentialSpellings = (
  user: string | undefined,
  password: string,
): string[] => {
  const encode = (value: string): string =>
    Buffer.from(value, "utf8").toString("base64");
  // Written as an escape: a literal NUL in source is invisible in review.
  const nul = "\u0000";

  const spellings = [password, encode(password)];
  if (user) {
    spellings.push(
      encode(`${nul}${user}${nul}${password}`),
      encode(`${user}${nul}${user}${nul}${password}`),
      encode(user),
    );
  }
  return spellings.filter((value) => value !== "");
};

/**
 * Turns an error into something safe to show.
 *
 * nodemailer attaches the SMTP conversation to its errors, and that
 * conversation can contain the base64 AUTH line. Only the code and a short
 * summary survive, the summary is scrubbed of every encoding of the configured
 * credentials, and then any base64 left standing is decoded and checked. That
 * last pass is the net for a mechanism nobody anticipated: it does not need to
 * know how the credential was encoded, only that it decodes to one.
 */
const safeMessage = (
  error: unknown,
  spellings: readonly string[],
  plain: readonly string[],
): string => {
  const raw =
    error instanceof Error
      ? `${(error as { code?: string }).code ?? error.name}: ${error.message}`
      : String(error);

  // Take the first line only: nodemailer's multi-line detail is the transcript.
  let message = raw.split("\n")[0] ?? raw;

  for (const spelling of spellings) {
    if (message.includes(spelling)) {
      message = message.replaceAll(spelling, REDACTED);
    }
  }

  if (plain.length > 0) {
    message = message.replace(BASE64_RUN, (token) => {
      let decoded: string;
      try {
        decoded = Buffer.from(token, "base64").toString("utf8");
      } catch {
        return token;
      }
      return plain.some((secret) => decoded.includes(secret))
        ? REDACTED
        : token;
    });
  }

  return message;
};

export class SmtpMailer implements Mailer {
  readonly #transport: Transporter;
  readonly #from: string;
  /** Every encoding of the credentials, replaced on sight. */
  readonly #spellings: readonly string[];
  /** The credentials themselves, for the decode-and-check pass. */
  readonly #plain: readonly string[];

  constructor(options: SmtpOptions) {
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.#from = options.from;
    this.#spellings = options.password
      ? credentialSpellings(options.user, options.password)
      : [];
    this.#plain = options.password ? [options.password] : [];
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
  async verify(): Promise<MailVerifyResult> {
    try {
      await this.#transport.verify();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: safeMessage(error, this.#spellings, this.#plain),
      };
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
      throw new Error(
        `SMTP send failed. ${safeMessage(error, this.#spellings, this.#plain)}`,
      );
    }
  }

  /** Releases pooled sockets. Called on process shutdown. */
  close(): void {
    this.#transport.close();
  }
}
