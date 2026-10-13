/**
 * The workspace mails, in the shared layout (docs/design/email-templates.md
 * §5): the invitation, the notification digest and an agent's nudge.
 *
 * Each builder takes data and the workspace's identity and returns the
 * subject and both parts. None reads the database: the callers already hold
 * what a mail says, and a builder that only builds is one a test can call.
 */
import type { DigestItem } from "../notifications/templates.ts";
import { withoutTrailingSlashes } from "../urls.ts";
import { type EmailBlock, renderEmail } from "./render.ts";
import type { MailWordKey } from "./words.ts";
import { type WorkspaceMail, workspaceFrame } from "./workspace.ts";

export interface BuiltMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Where a member changes what reaches them and when. */
const SETTINGS_PATH = "/account/channels";

export function invitationMail(input: {
  readonly mail: WorkspaceMail;
  readonly instanceName: string;
  readonly baseUrl: string;
  readonly link: string;
  readonly inviterName: string | null;
  readonly expiresAt: Date | null;
}): BuiltMail {
  const { mail } = input;
  const t = mail.words;
  // A row queued with no workspace still sends, under the instance's name.
  const named = mail.name !== "";
  const workspace = named ? mail.name : input.instanceName;
  const date = input.expiresAt
    ? input.expiresAt.toLocaleDateString(
        mail.locale === "ms" ? "ms-MY" : "en-GB",
        {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        },
      )
    : null;
  const { html, text } = renderEmail(
    workspaceFrame(
      { ...mail, name: workspace },
      {
        baseUrl: input.baseUrl,
        preheader: input.inviterName
          ? t("invite.preheaderBy", { inviter: input.inviterName })
          : t("invite.preheader"),
        footer: t("invite.footer"),
      },
    ),
    [
      { kind: "eyebrow", text: t("invite.eyebrow") },
      {
        kind: "heading",
        text: named
          ? t("invite.heading", { workspace, instance: input.instanceName })
          : t("invite.headingNoWorkspace", { instance: input.instanceName }),
      },
      {
        kind: "paragraph",
        parts: [
          ...(input.inviterName
            ? [{ bold: input.inviterName }, t("invite.invitedBy")]
            : []),
          named ? t("invite.body", { workspace }) : t("invite.bodyNoWorkspace"),
        ],
      },
      { kind: "action", label: t("invite.action"), href: input.link },
      {
        kind: "notice",
        parts: [
          date ? t("invite.noticeExpires", { date }) : t("invite.notice"),
        ],
      },
    ],
  );
  return { subject: t("invite.subject", { workspace }), html, text };
}

const REASON_WORDS: Readonly<Record<string, MailWordKey>> = {
  mentioned: "digest.reason.mentioned",
  joined: "digest.reason.joined",
  check_in: "digest.reason.check_in",
  review: "digest.reason.review",
  invited: "digest.reason.invited",
  role: "digest.reason.role",
};

/** One digest line as a row: its reason as a chip, who did it, where to go. */
function digestRows(
  mail: WorkspaceMail,
  items: readonly DigestItem[],
): EmailBlock & { readonly kind: "items" } {
  return {
    kind: "items",
    items: items.map((item) => {
      const reason = item.reason ? REASON_WORDS[item.reason] : undefined;
      return {
        ...(reason
          ? {
              chip: {
                label: mail.words(reason),
                // An obligation reads amber; news reads in the brand colour.
                tone:
                  item.reason === "review" || item.reason === "check_in"
                    ? ("warn" as const)
                    : ("brand" as const),
              },
            }
          : {}),
        parts: item.actorName
          ? [{ bold: item.actorName }, ` · ${item.summary}`]
          : [item.summary],
        link: { label: mail.words("digest.open"), href: item.link },
      };
    }),
  };
}

export function notificationDigestMail(input: {
  readonly mail: WorkspaceMail;
  readonly baseUrl: string;
  readonly items: readonly DigestItem[];
  readonly omitted: number;
}): BuiltMail {
  const { mail } = input;
  const t = mail.words;
  const count = input.items.length + input.omitted;
  const rows = digestRows(mail, input.items);
  const { html, text } = renderEmail(
    workspaceFrame(mail, {
      baseUrl: input.baseUrl,
      preheader: input.items[0]?.summary ?? "",
      footer: t("digest.footer"),
      settingsPath: SETTINGS_PATH,
    }),
    [
      {
        kind: "heading",
        text:
          count === 1
            ? t("digest.headingOne")
            : t("digest.headingMany", { count }),
      },
      { kind: "muted", text: t("digest.muted") },
      {
        ...rows,
        ...(input.omitted > 0
          ? { more: t("digest.more", { count: input.omitted }) }
          : {}),
      },
      {
        kind: "action",
        label: t("digest.action"),
        href: `${withoutTrailingSlashes(input.baseUrl)}/inbox`,
      },
    ],
  );
  return {
    subject:
      count === 1
        ? t("digest.subjectOne", { workspace: mail.name })
        : t("digest.subjectMany", { workspace: mail.name, count }),
    html,
    text,
  };
}

/**
 * What a nudge mail carries, kept on the channel message row and rendered
 * when the relay sends it (`deliverChannelMessage`). Blocks rather than
 * HTML: the message log stays readable, and the frame is read at sending
 * time, so it is the workspace's name and colour as they are then.
 */
export interface StoredEmail {
  readonly blocks: readonly EmailBlock[];
  readonly preheader?: string;
  readonly footer: string;
}

/**
 * One nudge as a mail: the agent who sends it, the headline, the coach's
 * line, the first button as the action, and the rule it follows.
 *
 * Built from the draft every channel shares, so a mail cannot say something
 * the chat message does not. The draft's text is the headline, then the
 * coach's line, then `Rule: <key>`; a blocker's draft carries more lines,
 * and each becomes a paragraph.
 */
export function nudgeEmail(input: {
  readonly mail: WorkspaceMail;
  readonly owner: "coach" | "champion";
  readonly ruleKey: string;
  readonly draft: {
    readonly text: string;
    readonly buttons?: readonly {
      readonly label: string;
      readonly url: string;
    }[];
  };
  /** The instance's address, for the summary's inbox button. */
  readonly baseUrl?: string;
  /** The daily summary's own rows, in place of the draft's lines. */
  readonly summary?: {
    readonly items: readonly DigestItem[];
    readonly omitted: number;
    readonly held: readonly DigestItem[];
  };
}): StoredEmail {
  const t = input.mail.words;
  const lines = input.draft.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("Rule:"));
  const [headline = "", ...rest] = lines;
  const web = (input.draft.buttons ?? []).filter((button) =>
    /^https?:\/\//.test(button.url),
  );
  const [primary, ...others] = web;
  const blocks: EmailBlock[] = [
    {
      kind: "agent",
      initials: input.owner === "coach" ? "CO" : "CH",
      name: t(input.owner === "coach" ? "nudge.coach" : "nudge.champion"),
      badge: t("nudge.badge"),
      role: t(
        input.owner === "coach" ? "nudge.coachRole" : "nudge.championRole",
      ),
    },
  ];
  if (input.summary) {
    blocks.push({ kind: "heading", text: t("nudge.summaryHeading") });
    if (input.summary.items.length > 0) {
      blocks.push({
        ...digestRows(input.mail, input.summary.items),
        ...(input.summary.omitted > 0
          ? { more: t("digest.more", { count: input.summary.omitted }) }
          : {}),
      });
    }
    if (input.summary.held.length > 0) {
      blocks.push({ kind: "eyebrow", text: t("nudge.summaryHeld") });
      blocks.push(digestRows(input.mail, input.summary.held));
    }
    // The rows link one by one; the inbox holds them all.
    if (input.baseUrl) {
      blocks.push({
        kind: "action",
        label: t("digest.action"),
        href: `${withoutTrailingSlashes(input.baseUrl)}/inbox`,
      });
    }
  } else {
    blocks.push({ kind: "heading", text: headline });
    for (const line of rest) {
      blocks.push({ kind: "paragraph", parts: [line] });
    }
  }
  if (primary) {
    blocks.push({ kind: "action", label: primary.label, href: primary.url });
  }
  if (others.length > 0) {
    blocks.push({
      kind: "items",
      items: others.map((button) => ({
        parts: [],
        link: { label: button.label, href: button.url },
      })),
    });
  }
  return {
    blocks,
    preheader: input.summary ? headline : (rest[0] ?? headline),
    footer: t("nudge.footer", { rule: input.ruleKey }),
  };
}

/** A stored nudge mail, framed in the workspace as it is now. */
export function renderStoredEmail(input: {
  readonly mail: WorkspaceMail;
  readonly baseUrl: string;
  readonly stored: StoredEmail;
}): { readonly html: string; readonly text: string } {
  return renderEmail(
    workspaceFrame(input.mail, {
      baseUrl: input.baseUrl,
      ...(input.stored.preheader ? { preheader: input.stored.preheader } : {}),
      footer: input.stored.footer,
      settingsPath: SETTINGS_PATH,
      settingsLabel: input.mail.words("snoozeOrChangeChannel"),
    }),
    input.stored.blocks,
  );
}
