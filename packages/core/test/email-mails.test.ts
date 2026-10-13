import { describe, expect, it } from "vitest";
import {
  invitationMail,
  notificationDigestMail,
  nudgeEmail,
  renderStoredEmail,
} from "../src/mail/mails.ts";
import { MAIL_WORD_TABLES, mailWords } from "../src/mail/words.ts";
import type { WorkspaceMail } from "../src/mail/workspace.ts";

/**
 * The workspace mails (docs/design/email-templates.md §5): what each says, in
 * which language, and that every link in it is one the instance serves.
 */

const BASE = "https://okr.example.test";

const mail = (over: Partial<WorkspaceMail> = {}): WorkspaceMail => ({
  name: "Northwind Labs",
  color: "#0f766e",
  locale: "en",
  words: mailWords("en"),
  ...over,
});

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    (match[1] as string).replaceAll("&amp;", "&"),
  );

describe("the word tables", () => {
  it("hold the same keys and the same holes in every language", () => {
    const holes = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = MAIL_WORD_TABLES.en;
    for (const [locale, table] of Object.entries(MAIL_WORD_TABLES)) {
      expect(Object.keys(table).sort(), locale).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(holes(table[key]), `${locale} ${key}`).toEqual(holes(en[key]));
      }
    }
  });
});

describe("the invitation", () => {
  it("names the workspace and the inviter, and links to the join page", () => {
    const built = invitationMail({
      mail: mail(),
      instanceName: "OpenOKR",
      baseUrl: BASE,
      link: `${BASE}/join/tok`,
      inviterName: "Priya Raman",
      expiresAt: new Date("2026-10-19T00:00:00Z"),
    });
    expect(built.subject).toBe("You have been invited to Northwind Labs");
    expect(built.html).toContain("<b>Priya Raman</b>");
    expect(built.html).toContain("19 October 2026");
    // The workspace's own colour, which white text reads on.
    expect(built.html).toContain("#0f766e");
    expect(new Set(hrefs(built.html))).toEqual(new Set([`${BASE}/join/tok`]));
    expect(built.text).toContain(`Accept the invitation: ${BASE}/join/tok`);
  });

  it("speaks the workspace's language", () => {
    const built = invitationMail({
      mail: mail({ locale: "ms", words: mailWords("ms") }),
      instanceName: "OpenOKR",
      baseUrl: BASE,
      link: `${BASE}/join/tok`,
      inviterName: null,
      expiresAt: null,
    });
    expect(built.subject).toBe("Anda dijemput ke Northwind Labs");
    expect(built.html).toContain('<html lang="ms">');
    expect(built.html).toContain("Terima jemputan");
  });
});

describe("the notification digest", () => {
  const items = [
    {
      summary: "Commented on a goal: Can we start Monday?",
      link: `${BASE}/goals/g1`,
      reason: "joined",
      actorName: "Priya Raman",
    },
    {
      summary: "A check-in is waiting on your review.",
      link: `${BASE}/check-in`,
      reason: "review",
    },
  ];

  it("names who did what, and says what was left out in both parts", () => {
    const built = notificationDigestMail({
      mail: mail(),
      baseUrl: BASE,
      items,
      omitted: 3,
    });
    expect(built.subject).toBe("Northwind Labs: 5 updates");
    expect(built.html).toContain("<b>Priya Raman</b>");
    // The line that used to be in the text part only.
    expect(built.html).toContain("And 3 more in your inbox.");
    expect(built.text).toContain("And 3 more in your inbox.");
    expect(new Set(hrefs(built.html))).toEqual(
      new Set([
        `${BASE}/goals/g1`,
        `${BASE}/check-in`,
        `${BASE}/inbox`,
        `${BASE}/account/channels`,
      ]),
    );
  });
});

describe("a nudge", () => {
  it("is the agent's message with its rule, and only web links", () => {
    const stored = nudgeEmail({
      mail: mail(),
      owner: "champion",
      ruleKey: "checkin.overdue",
      draft: {
        text: "Check-in overdue: Make onboarding stick\n\nWhat moved since last week?\n\nRule: checkin.overdue",
        buttons: [
          { label: "Check in", url: `${BASE}/check-in?goal=g1` },
          { label: "Snooze", url: "okr:snooze n1" },
        ],
      },
    });
    const { html, text } = renderStoredEmail({
      mail: mail(),
      baseUrl: BASE,
      stored,
    });
    expect(html).toContain("OKR Champion");
    expect(html).toContain("Check-in overdue: Make onboarding stick");
    expect(html).toContain("checkin.overdue");
    // A chat command is not a link a mail can carry.
    expect(html).not.toContain("okr:snooze");
    expect(new Set(hrefs(html))).toEqual(
      new Set([`${BASE}/check-in?goal=g1`, `${BASE}/account/channels`]),
    );
    expect(text).toContain("checkin.overdue");
  });

  it("lists the daily summary's rows, and what the weekly ceiling held", () => {
    const stored = nudgeEmail({
      mail: mail(),
      owner: "champion",
      ruleKey: "digest.daily",
      draft: { text: "Here is what happened since you last looked." },
      baseUrl: BASE,
      summary: {
        items: [
          {
            summary: "Sara checked in",
            link: `${BASE}/goals/g1`,
            reason: "joined",
          },
        ],
        omitted: 0,
        held: [{ summary: "A check-in is overdue", link: `${BASE}/goals/g2` }],
      },
    });
    const { html } = renderStoredEmail({ mail: mail(), baseUrl: BASE, stored });
    expect(html).toContain("Since you last looked");
    expect(html).toContain("Sara checked in");
    expect(html).toContain("Held back this week");
    expect(html).toContain(`${BASE}/goals/g2`);
    expect(html).toContain(`href="${BASE}/inbox"`);
  });
});
