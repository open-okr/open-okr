/**
 * Per-reason mail templates (TECHNICAL-PLAN §4.11, P2-T06, docs/design/languages.md §13):
 * HTML and plain text for a single immediate notification, and a digest variant for a
 * batch. Rendered in the recipient's resolved locale.
 */
import { serverTranslate } from "../i18n/catalogue.ts";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export interface MailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface MentionNotificationInput {
  readonly actorName: string;
  readonly subjectTitle: string;
  readonly link: string;
}

export function renderMentionNotification(
  input: MentionNotificationInput,
  locale = "en",
): MailContent {
  const subject = serverTranslate(locale, "notification.mention.subject", {
    actorName: input.actorName,
    subjectTitle: input.subjectTitle,
  });
  const text = `${subject}.\n\n${input.link}\n`;
  const openLabel = serverTranslate(locale, "notification.mention.action");
  const html =
    `<p>${escapeHtml(input.actorName)} mentioned you in ` +
    `&ldquo;${escapeHtml(input.subjectTitle)}&rdquo;.</p>` +
    `<p><a href="${escapeHtml(input.link)}">${escapeHtml(openLabel)}</a></p>`;
  return { subject, text, html };
}

export interface DigestItem {
  readonly summary: string;
  readonly link: string;
  /** Why the member got it, which the mail shows as a chip. */
  readonly reason?: string;
  /** The member whose action this was, when one was. */
  readonly actorName?: string | null;
}

export interface DigestInput {
  readonly items: readonly DigestItem[];
}

/**
 * The digest for one batch or one daily summary — the shape is the same
 * either way, a list of items, and what decides which one a member gets is
 * the window that collected them, not the template.
 */
export function renderDigest(input: DigestInput, locale = "en"): MailContent {
  const count = input.items.length;
  const subject = serverTranslate(
    locale,
    count === 1
      ? "notification.digest.subject.one"
      : "notification.digest.subject.other",
    { count },
  );
  const text = input.items
    .map((item) => `- ${item.summary}\n  ${item.link}`)
    .join("\n");
  const html = `<ul>${input.items
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.link)}">${escapeHtml(item.summary)}</a></li>`,
    )
    .join("")}</ul>`;
  return { subject, text, html };
}
