/**
 * The Mailer port (TECHNICAL-PLAN §5).
 *
 * Email is the always-available channel: every other provider can be absent,
 * this one cannot. Bodies are rendered upstream through the shared rich-text
 * module, so a driver never builds HTML itself.
 */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  /** Deduplication key, so a retried send is one email. */
  readonly idempotencyKey?: string;
}

export interface SentMail {
  readonly messageId: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<SentMail>;
}
