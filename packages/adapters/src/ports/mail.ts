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

/** What a connection test may say. Never contains a credential. */
export type MailVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface Mailer {
  send(message: MailMessage): Promise<SentMail>;
  /**
   * Proves the configuration without sending anything. The first-run wizard
   * and the admin mail card call this, so an operator learns about a wrong
   * port from a test button rather than from the first invitation that never
   * arrives.
   */
  verify(): Promise<MailVerifyResult>;
  /** Releases whatever this driver holds open. The console driver holds
   * nothing; the SMTP driver holds pooled sockets that outlive the process
   * otherwise. Call on process shutdown. */
  stop(): Promise<void>;
}
