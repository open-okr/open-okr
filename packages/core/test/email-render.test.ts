import { describe, expect, it } from "vitest";
import {
  brandInitials,
  buttonColour,
  EMAIL_BRAND,
  type EmailBlock,
  type EmailFrame,
  renderEmail,
} from "../src/mail/render.ts";

/**
 * The one email layout (docs/design/email-templates.md §7). Pure strings, so
 * no database: what is proved here is what every mail inherits.
 */

const BASE = "https://okr.example.test";

const frame = (over: Partial<EmailFrame> = {}): EmailFrame => ({
  lang: "en",
  brand: { name: "Northwind Labs" },
  footer: ["You follow these goals."],
  footerLink: {
    label: "Change what you receive",
    href: `${BASE}/account/channels`,
  },
  labels: {
    linkFallback: "Button not working? Paste this link into your browser:",
  },
  ...over,
});

const everyBlock: EmailBlock[] = [
  { kind: "eyebrow", text: "Invitation" },
  { kind: "heading", text: "Join Northwind Labs" },
  { kind: "muted", text: "From the goals you follow." },
  { kind: "paragraph", parts: [{ bold: "Priya Raman" }, " invited you."] },
  { kind: "action", label: "Accept the invitation", href: `${BASE}/join/abc` },
  { kind: "notice", parts: ["Expires on ", { bold: "19 October" }, "."] },
  {
    kind: "agent",
    initials: "CH",
    name: "OKR Champion",
    badge: "AGENT",
    role: "Keeps the rhythm",
  },
  {
    kind: "items",
    items: [
      {
        chip: { label: "Comment", tone: "brand" },
        time: "09:14",
        parts: [{ bold: "Priya" }, " · Can we start Monday?"],
        link: { label: "Make onboarding stick", href: `${BASE}/goals/g1` },
      },
    ],
    more: "And 2 more in your inbox.",
  },
  {
    kind: "nudges",
    nudges: [
      {
        title: "Check-in overdue",
        body: "The cycle reads stale.",
        tone: "bad",
        link: { label: "Check in now", href: `${BASE}/check-in` },
        rule: "checkin.overdue · step 2",
      },
    ],
  },
  {
    kind: "stats",
    tiles: [
      { value: "5", label: "On track", tone: "ok" },
      { value: "1", label: "Off track", tone: "bad" },
    ],
  },
  { kind: "list", title: "Wins", items: ["Completion reached 64%"] },
];

describe("the email layout", () => {
  it("escapes every value, so a title can never become markup", () => {
    const { html, text } = renderEmail(frame({ brand: { name: "A<b>&\"'" } }), [
      { kind: "heading", text: "<script>alert(1)</script>" },
      { kind: "paragraph", parts: [{ bold: "<img src=x onerror=1>" }] },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A&lt;b&gt;&amp;&quot;&#39;");
    // The plain part is plain: it carries the characters as written.
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("puts every link and every line in the text part too, so the two never drift", () => {
    const { html, text } = renderEmail(frame(), everyBlock);
    for (const href of [
      `${BASE}/join/abc`,
      `${BASE}/goals/g1`,
      `${BASE}/check-in`,
      `${BASE}/account/channels`,
    ]) {
      expect(html, href).toContain(`href="${href}"`);
      expect(text, href).toContain(href);
    }
    for (const line of [
      "Join Northwind Labs",
      "Priya Raman invited you.",
      "And 2 more in your inbox.",
      "checkin.overdue · step 2",
      "5 On track, 1 Off track",
      "- Completion reached 64%",
    ]) {
      expect(text, line).toContain(line);
    }
  });

  it("fetches nothing: no remote font, image or stylesheet", () => {
    const { html } = renderEmail(frame(), everyBlock);
    expect(html).not.toMatch(/<img|<link|@import|url\(|@font-face/i);
    const hosts = new Set(
      [...html.matchAll(/https?:\/\/[^"'<\s)]+/g)].map(
        (match) => new URL(match[0]).origin,
      ),
    );
    expect([...hosts]).toEqual([BASE]);
  });

  it("refuses a link that is not http or https", () => {
    expect(() =>
      renderEmail(frame(), [
        { kind: "action", label: "Go", href: "javascript:alert(1)" },
      ]),
    ).toThrow(/http or https/);
  });

  it("shows the raw link under the button, for a client that will not click it", () => {
    const { html } = renderEmail(frame(), [
      {
        kind: "action",
        label: "Confirm email",
        href: `${BASE}/verify?token=1`,
      },
    ]);
    expect(html).toContain("Button not working?");
    expect(
      html.match(/href="https:\/\/okr\.example\.test\/verify\?token=1"/g),
    ).toHaveLength(2);
  });

  it("declares its language and its light and dark schemes", () => {
    const { html } = renderEmail(frame({ lang: "ms" }), everyBlock);
    expect(html).toContain('<html lang="ms">');
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain("prefers-color-scheme:dark");
  });
});

describe("the brand", () => {
  it("takes a workspace colour white text reads on, and the product's indigo otherwise", () => {
    expect(buttonColour("#0F766E")).toBe("#0f766e");
    // Pale yellow fails 4.5:1 with white text on it.
    expect(buttonColour("#fde047")).toBe(EMAIL_BRAND);
    expect(buttonColour(null)).toBe(EMAIL_BRAND);
    expect(buttonColour("red")).toBe(EMAIL_BRAND);
  });

  it("marks the mail with two initials", () => {
    expect(brandInitials("Northwind Labs")).toBe("NL");
    expect(brandInitials("OpenOKR")).toBe("OP");
    expect(brandInitials("  ")).toBe("OK");
  });
});
