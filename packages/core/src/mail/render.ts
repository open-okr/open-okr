/**
 * The one email layout (docs/design/email-templates.md).
 *
 * A mail is a frame and a list of blocks. This turns both into the HTML part
 * and the plain-text part together, so the two can never say different
 * things: the digest's "and N more" line once lived in the text part only.
 *
 * **Tables and inline styles, on purpose.** Outlook on Windows renders mail
 * with Word's engine, which ignores most of CSS; Gmail strips `<style>`. The
 * layout a person sees is therefore written inline, and the `<style>` block
 * carries only what a client may drop safely: dark mode and a narrow screen.
 *
 * **Nothing is fetched.** No web font, no image: the mark is two letters in
 * a coloured square. An air-gapped instance has nothing to serve a mail
 * client, and a remote asset would also tell a sender when a mail was read.
 *
 * **Every value is escaped here**, and a mail can pass no markup at all.
 * A goal title or a comment excerpt is text, whatever characters it holds.
 */

/** A run of text, optionally bold. The only inline formatting a mail gets. */
type EmailInline = string | { readonly bold: string };

type EmailTone = "brand" | "ok" | "warn" | "bad";

interface EmailLink {
  readonly label: string;
  readonly href: string;
}

interface EmailItem {
  readonly chip?: { readonly label: string; readonly tone: EmailTone };
  readonly time?: string;
  readonly parts: readonly EmailInline[];
  readonly link?: EmailLink;
}

interface EmailNudge {
  readonly title: string;
  readonly body: string;
  readonly tone: EmailTone;
  readonly link: EmailLink;
  /** The rule key and the escalation step, which every proactive message shows. */
  readonly rule: string;
}

export type EmailBlock =
  | { readonly kind: "eyebrow"; readonly text: string }
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "muted"; readonly text: string }
  | { readonly kind: "paragraph"; readonly parts: readonly EmailInline[] }
  | { readonly kind: "action"; readonly label: string; readonly href: string }
  | { readonly kind: "notice"; readonly parts: readonly EmailInline[] }
  | {
      readonly kind: "agent";
      readonly initials: string;
      readonly name: string;
      readonly badge: string;
      readonly role: string;
    }
  | {
      readonly kind: "items";
      readonly items: readonly EmailItem[];
      readonly more?: string;
    }
  | { readonly kind: "nudges"; readonly nudges: readonly EmailNudge[] }
  | {
      readonly kind: "stats";
      readonly tiles: readonly {
        readonly value: string;
        readonly label: string;
        readonly tone: Exclude<EmailTone, "brand">;
      }[];
    }
  | {
      readonly kind: "list";
      readonly title: string;
      readonly items: readonly string[];
    };

export interface EmailFrame {
  /** The page's `lang`, so a screen reader reads the mail in its language. */
  readonly lang: string;
  /** Who the mail is from: the workspace, or the instance for account mail. */
  readonly brand: { readonly name: string; readonly color?: string | null };
  /** The line a mail client shows after the subject in the list. */
  readonly preheader?: string;
  /** Why the person got this, under the card. */
  readonly footer: readonly EmailInline[];
  readonly footerLink?: EmailLink;
  /** Words the layout itself needs, already translated by the caller. */
  readonly labels: {
    /** "Button not working? Paste this link into your browser:" */
    readonly linkFallback: string;
  };
}

export interface RenderedEmail {
  readonly html: string;
  readonly text: string;
}

/** The product's indigo, `--brand` in packages/ui/src/styles/tokens.css. */
export const EMAIL_BRAND = "#4f46e5";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const INK = "#0f172a";
const INK_2 = "#334155";
const INK_3 = "#55637a";
const INK_4 = "#617087";
const LINE = "#e4e9f2";
const PAGE = "#eff3f9";
const LINK = "#4338ca";

const TONES: Readonly<
  Record<EmailTone, { readonly fg: string; readonly bg: string }>
> = {
  brand: { fg: LINK, bg: "#eef2ff" },
  ok: { fg: "#15803d", bg: "#e4f9ec" },
  warn: { fg: "#b45309", bg: "#fdf3d5" },
  bad: { fg: "#b91c1c", bg: "#fde9e9" },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * A link a mail may carry: http or https, nothing else. A `javascript:` or a
 * relative path in a mail is a bug in whoever built it, and failing loudly
 * here is better than shipping a link that goes nowhere.
 */
function safeHref(href: string): string {
  const parsed = new URL(href);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`A mail link must be http or https, not ${href}`);
  }
  return escapeHtml(parsed.toString());
}

/** The two letters in the mark: the first of the first two words. */
export function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "OK";
}

const channel = (hex: string, at: number): number => {
  const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  );
}

/**
 * The workspace's colour when white text on it reads at 4.5:1 (WCAG AA), the
 * product's indigo otherwise. A pale brand colour would leave the button's
 * own label unreadable, and the button is the one thing the mail is for.
 */
export function buttonColour(color: string | null | undefined): string {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return EMAIL_BRAND;
  }
  const contrast = 1.05 / (luminance(color) + 0.05);
  return contrast >= 4.5 ? color.toLowerCase() : EMAIL_BRAND;
}

function inlineHtml(parts: readonly EmailInline[]): string {
  return parts
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part)
        : `<b>${escapeHtml(part.bold)}</b>`,
    )
    .join("");
}

function inlineText(parts: readonly EmailInline[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part : part.bold))
    .join("");
}

function chipHtml(label: string, tone: EmailTone): string {
  const colours = TONES[tone];
  const className = tone === "brand" ? "em-chip" : `em-chip-${tone}`;
  return `<span class="${className}" style="display:inline-block;padding:1px 7px;border-radius:999px;background:${colours.bg};color:${colours.fg};font-size:11px;font-weight:600;">${escapeHtml(label)}</span>`;
}

function blockHtml(
  block: EmailBlock,
  button: string,
  labels: EmailFrame["labels"],
): string {
  switch (block.kind) {
    case "eyebrow":
      return `<p class="em-ink3" style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${INK_3};">${escapeHtml(block.text)}</p>`;
    case "heading":
      return `<h1 class="em-ink" style="margin:0 0 10px;font-size:18px;line-height:1.35;font-weight:700;color:${INK};">${escapeHtml(block.text)}</h1>`;
    case "muted":
      return `<p class="em-ink3" style="margin:-6px 0 14px;font-size:13px;line-height:1.5;color:${INK_3};">${escapeHtml(block.text)}</p>`;
    case "paragraph":
      return `<p class="em-ink2" style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${INK_2};">${inlineHtml(block.parts)}</p>`;
    case "action": {
      const href = safeHref(block.href);
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${button}" style="border-radius:8px;background:${button};">` +
        `<a href="${href}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>` +
        `</td></tr></table>` +
        `<p class="em-ink3" style="margin:14px 0 18px;font-size:12px;line-height:1.5;color:${INK_3};">${escapeHtml(labels.linkFallback)}<br><a class="em-link" href="${href}" style="color:${LINK};word-break:break-all;">${href}</a></p>`
      );
    }
    case "notice":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr><td class="em-soft em-ink2" style="background:${PAGE};border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;color:${INK_2};">${inlineHtml(block.parts)}</td></tr></table>`;
    case "agent":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr>` +
        `<td class="em-chip" width="28" height="28" align="center" style="width:28px;height:28px;background:${TONES.brand.bg};border-radius:999px;color:${LINK};font:700 11px/28px ${FONT};">${escapeHtml(block.initials)}</td>` +
        `<td style="padding-left:9px;font-family:${FONT};">` +
        `<span class="em-ink" style="font-size:13px;font-weight:700;color:${INK};">${escapeHtml(block.name)}</span>` +
        `<span class="em-soft em-ink3" style="display:inline-block;margin-left:4px;padding:0 5px;border-radius:4px;background:${PAGE};color:${INK_3};font-size:10px;font-weight:700;letter-spacing:.4px;">${escapeHtml(block.badge)}</span><br>` +
        `<span class="em-ink3" style="font-size:12px;color:${INK_4};">${escapeHtml(block.role)}</span>` +
        `</td></tr></table>`
      );
    case "items": {
      const rows = block.items
        .map((item, index) => {
          const last = index === block.items.length - 1;
          const head = [
            item.chip ? chipHtml(item.chip.label, item.chip.tone) : "",
            item.time
              ? `<span class="em-ink3" style="font-size:12px;color:${INK_4};">&nbsp;${escapeHtml(item.time)}</span>`
              : "",
          ].join("");
          const link = item.link
            ? `<a class="em-link" href="${safeHref(item.link.href)}" style="font-size:13px;color:${LINK};text-decoration:none;">${escapeHtml(item.link.label)} &rarr;</a>`
            : "";
          return (
            `<tr><td class="em-line" style="padding:12px 0;border-top:1px solid ${LINE};${last ? `border-bottom:1px solid ${LINE};` : ""}">` +
            head +
            (item.parts.length > 0
              ? `<p class="em-ink" style="margin:${head ? "6px" : "0"} 0 2px;font-size:14px;line-height:1.5;color:${INK};">${inlineHtml(item.parts)}</p>`
              : "") +
            link +
            `</td></tr>`
          );
        })
        .join("");
      const more = block.more
        ? `<p class="em-ink3" style="margin:12px 0 18px;font-size:13px;color:${INK_3};">${escapeHtml(block.more)}</p>`
        : `<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>${more}`;
    }
    case "nudges":
      return block.nudges
        .map((nudge) => {
          const edge = TONES[nudge.tone].fg;
          return (
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;"><tr><td class="em-edge" style="border:1px solid ${LINE};border-left:3px solid ${edge};border-radius:8px;padding:12px 14px;">` +
            `<p class="em-ink" style="margin:0 0 4px;font-size:14px;font-weight:600;color:${INK};">${escapeHtml(nudge.title)}</p>` +
            `<p class="em-ink2" style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${INK_2};">${escapeHtml(nudge.body)}</p>` +
            `<a class="em-link" href="${safeHref(nudge.link.href)}" style="font-size:13px;font-weight:600;color:${LINK};text-decoration:none;">${escapeHtml(nudge.link.label)} &rarr;</a>` +
            `<span class="em-ink3" style="float:right;font-size:11px;color:${INK_4};font-family:${MONO};">${escapeHtml(nudge.rule)}</span>` +
            `</td></tr></table>`
          );
        })
        .join("");
    case "stats": {
      const cells = block.tiles
        .map(
          (tile) =>
            `<td width="${Math.floor(100 / block.tiles.length) - 1}%" class="em-${tile.tone}" style="background:${TONES[tile.tone].bg};border-radius:8px;padding:10px 12px;color:${TONES[tile.tone].fg};">` +
            `<p style="margin:0;font-size:20px;font-weight:700;color:${TONES[tile.tone].fg};">${escapeHtml(tile.value)}</p>` +
            `<p style="margin:0;font-size:12px;color:${TONES[tile.tone].fg};">${escapeHtml(tile.label)}</p></td>`,
        )
        .join(
          `<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>`,
        );
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>${cells}</tr></table>`;
    }
    case "list":
      return (
        `<p class="em-ink" style="margin:0 0 6px;font-size:13px;font-weight:700;color:${INK};">${escapeHtml(block.title)}</p>` +
        `<ul class="em-ink2" style="margin:0 0 14px;padding-left:18px;font-size:14px;line-height:1.6;color:${INK_2};">` +
        block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") +
        `</ul>`
      );
  }
}

function blockText(block: EmailBlock): string[] {
  switch (block.kind) {
    case "eyebrow":
      return [];
    case "heading":
      return [block.text, ""];
    case "muted":
      return [block.text, ""];
    case "paragraph":
      return [inlineText(block.parts), ""];
    case "action":
      return [`${block.label}: ${block.href}`, ""];
    case "notice":
      return [inlineText(block.parts), ""];
    case "agent":
      return [`${block.name} (${block.badge})`, ""];
    case "items":
      return [
        ...block.items.flatMap((item) =>
          item.parts.length > 0
            ? [
                `- ${item.chip ? `[${item.chip.label}] ` : ""}${inlineText(item.parts)}`,
                ...(item.link
                  ? [`  ${item.link.label}: ${item.link.href}`]
                  : []),
              ]
            : item.link
              ? [`- ${item.link.label}: ${item.link.href}`]
              : [],
        ),
        ...(block.more ? ["", block.more] : []),
        "",
      ];
    case "nudges":
      return [
        ...block.nudges.flatMap((nudge) => [
          `- ${nudge.title} (${nudge.rule})`,
          `  ${nudge.body}`,
          `  ${nudge.link.label}: ${nudge.link.href}`,
        ]),
        "",
      ];
    case "stats":
      return [
        block.tiles.map((tile) => `${tile.value} ${tile.label}`).join(", "),
        "",
      ];
    case "list":
      return [block.title, ...block.items.map((item) => `- ${item}`), ""];
  }
}

/** Dark mode and a narrow screen: the parts a client may drop safely. */
const STYLE = `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme:dark){
.em-bg{background:#0b1220 !important;}
.em-card{background:#111827 !important;border-color:#1e293b !important;}
.em-ink{color:#f1f5f9 !important;}
.em-ink2{color:#cbd5e1 !important;}
.em-ink3{color:#94a3b8 !important;}
.em-line{border-color:#1e293b !important;}
.em-edge{border-top-color:#1e293b !important;border-right-color:#1e293b !important;border-bottom-color:#1e293b !important;}
.em-soft{background:#1a2332 !important;}
.em-link{color:#818cf8 !important;}
.em-chip{background:#1e1b4b !important;color:#a5b4fc !important;}
.em-chip-ok,.em-ok{background:#052e1b !important;color:#4ade80 !important;}
.em-chip-warn,.em-warn{background:#3a2a06 !important;color:#fbbf24 !important;}
.em-chip-bad,.em-bad{background:#3b0d0d !important;color:#f87171 !important;}
.em-ok p,.em-warn p,.em-bad p{color:inherit !important;}
}
@media (max-width:600px){.em-card{padding:20px !important;}}
</style>`;

export function renderEmail(
  frame: EmailFrame,
  blocks: readonly EmailBlock[],
): RenderedEmail {
  const button = buttonColour(frame.brand.color);
  const name = escapeHtml(frame.brand.name);
  const footer =
    inlineHtml(frame.footer) +
    (frame.footerLink
      ? ` <a class="em-link" href="${safeHref(frame.footerLink.href)}" style="color:${LINK};">${escapeHtml(frame.footerLink.label)}</a>`
      : "");

  const html =
    `<!doctype html><html lang="${escapeHtml(frame.lang)}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<title>${name}</title>${STYLE}</head>` +
    `<body style="margin:0;padding:0;background:${PAGE};">` +
    (frame.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(frame.preheader)}</div>`
      : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-bg" style="background:${PAGE};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">` +
    `<tr><td style="padding:0 4px 14px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td width="24" height="24" align="center" style="width:24px;height:24px;background:${button};border-radius:6px;color:#ffffff;font:700 10px/24px ${FONT};">${escapeHtml(brandInitials(frame.brand.name))}</td>` +
    `<td class="em-ink" style="padding-left:8px;font:650 14px ${FONT};color:${INK};">${name}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td class="em-card" style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:24px;font-family:${FONT};">` +
    blocks.map((block) => blockHtml(block, button, frame.labels)).join("") +
    `</td></tr>` +
    `<tr><td class="em-ink3" style="padding:14px 4px 0;font:12px/1.5 ${FONT};color:${INK_4};">${footer}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const lines = [
    frame.brand.name,
    "",
    ...blocks.flatMap((block) => blockText(block)),
    "--",
    inlineText(frame.footer) +
      (frame.footerLink
        ? ` ${frame.footerLink.label}: ${frame.footerLink.href}`
        : ""),
  ];
  return { html, text: `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n` };
}
