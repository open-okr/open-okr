/**
 * Per-reason mail templates (TECHNICAL-PLAN §4.11, P2-T06): HTML and plain
 * text for a single immediate notification, and a digest variant for a
 * batch. Pure string builders, no templating engine: CLAUDE.md's rich-text
 * rule ("a sanitising allow-list at every surface, including email") is
 * about content that came from a member; every value woven in here is a
 * title or a name already stored as plain text, not editor JSON, so there
 * is nothing to sanitise that the rich-text renderer owns.
 *
 * No development preview page is built: apps/web has no shell yet
 * (P2-T10), and a route rendering these two functions' own output would be
 * throwaway until it exists. Recorded in STATUS.md.
 */

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
): MailContent {
  const subject = `${input.actorName} mentioned you in "${input.subjectTitle}"`;
  const text = `${input.actorName} mentioned you in "${input.subjectTitle}".\n\n${input.link}\n`;
  const html =
    `<p>${escapeHtml(input.actorName)} mentioned you in ` +
    `&ldquo;${escapeHtml(input.subjectTitle)}&rdquo;.</p>` +
    `<p><a href="${escapeHtml(input.link)}">Open it</a></p>`;
  return { subject, text, html };
}

export interface DigestItem {
  readonly summary: string;
  readonly link: string;
}

export interface DigestInput {
  readonly items: readonly DigestItem[];
}

/**
 * The digest for one batch or one daily summary — the shape is the same
 * either way, a list of items, and what decides which one a member gets is
 * the window that collected them, not the template.
 */
export function renderDigest(input: DigestInput): MailContent {
  const count = input.items.length;
  const subject = count === 1 ? "1 update" : `${count} updates`;
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
