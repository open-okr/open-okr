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
  {
    kind: "richText",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            {
              type: "text",
              text: "the brief",
              marks: [
                { type: "link", attrs: { href: `${BASE}/documents/d1` } },
              ],
            },
            { type: "text", text: " first." },
          ],
        },
      ],
    },
  },
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
      `${BASE}/documents/d1`,
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
      `Read the brief (${BASE}/documents/d1) first.`,
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

/**
 * Editor JSON in a mail (plan 0.7.0, R3; email-templates.md §3). Rendered
 * through the one rich text module, with its allow-list, in both parts:
 * CLAUDE.md asks for the sanitising renderer at every surface, email
 * included, and a mail is where an imported document is least watched.
 */
describe("the richText block", () => {
  const text = (value: string, marks?: unknown[]) =>
    marks
      ? { type: "text", text: value, marks }
      : { type: "text", text: value };
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const paragraph = (...content: unknown[]) => ({
    type: "paragraph",
    content,
  });
  const link = (href: string) => [{ type: "link", attrs: { href } }];
  const rendered = (document: unknown) =>
    renderEmail(frame(), [{ kind: "richText", document }]);
  // What the card holds, without the header and the footer around it.
  const card = (html: string) =>
    html.slice(
      html.indexOf('class="em-card"'),
      html.indexOf("padding:14px 4px 0"),
    );

  it("keeps the document's structure in the HTML, from the allow-list's own tags", () => {
    const { html } = rendered(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
        paragraph(text("Ship "), text("Monday", [{ type: "bold" }]), text(".")),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph(text("Pricing"))] },
            { type: "listItem", content: [paragraph(text("Onboarding"))] },
          ],
        },
      ),
    );
    expect(card(html)).toContain("<h2>Plan</h2>");
    expect(card(html)).toContain("<p>Ship <strong>Monday</strong>.</p>");
    expect(card(html)).toContain(
      "<ul><li><p>Pricing</p></li><li><p>Onboarding</p></li></ul>",
    );
  });

  it("reads as plain text in the text part: a line per paragraph, a dash per item, a number per step", () => {
    const { text: part } = rendered(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
        paragraph(text("Ship "), text("Monday", [{ type: "bold" }]), text(".")),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph(text("Pricing"))] },
            { type: "listItem", content: [paragraph(text("Onboarding"))] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [paragraph(text("Draft"))] },
            { type: "listItem", content: [paragraph(text("Publish"))] },
          ],
        },
        {
          type: "blockquote",
          content: [paragraph(text("Done is better than perfect."))],
        },
      ),
    );
    expect(part).toContain(
      [
        "Plan",
        "",
        "Ship Monday.",
        "",
        "- Pricing",
        "- Onboarding",
        "",
        "1. Draft",
        "2. Publish",
        "",
        "> Done is better than perfect.",
      ].join("\n"),
    );
    expect(part).not.toContain("<");
  });

  it("never lets a script typed into the document reach the HTML as markup", () => {
    const { html, text: part } = rendered(
      doc(paragraph(text("<script>alert(1)</script><img src=x onerror=1>"))),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The plain part carries the characters as written, which is harmless.
    expect(part).toContain("<script>alert(1)</script>");
  });

  it("never carries an unsafe link, in either part, and keeps the words", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      const { html, text: part } = rendered(
        doc(paragraph(text("Click me", link(href)))),
      );
      expect(card(html), href).toContain("Click me");
      expect(card(html), href).not.toContain("<a ");
      expect(html.toLowerCase(), href).not.toContain(href.toLowerCase());
      expect(html.toLowerCase(), href).not.toMatch(
        /javascript:|vbscript:|data:text/,
      );
      expect(part, href).toContain("Click me");
      expect(part.toLowerCase(), href).not.toContain(href.toLowerCase());
    }
  });

  it("leaves out a relative link, which goes nowhere from a mail client", () => {
    const { html, text: part } = rendered(
      doc(paragraph(text("the goal", link("/goals/g1")))),
    );
    expect(card(html)).toContain("<p>the goal</p>");
    expect(card(html)).not.toContain("href=");
    expect(part).not.toContain("/goals/g1");
  });

  it("keeps an absolute web or mail link, and names it in the text part", () => {
    const { html, text: part } = rendered(
      doc(
        paragraph(
          text("Ask ", undefined),
          text("Mei", link("mailto:mei@example.com")),
          text(" or read "),
          text("the notes", link(`${BASE}/documents/d1`)),
        ),
      ),
    );
    expect(card(html)).toContain(
      '<a href="mailto:mei@example.com" rel="noopener noreferrer">Mei</a>',
    );
    expect(card(html)).toContain(`href="${BASE}/documents/d1"`);
    expect(part).toContain(
      `Ask Mei (mailto:mei@example.com) or read the notes (${BASE}/documents/d1)`,
    );
  });

  it("says a mention as @name, in both parts", () => {
    const { html, text: part } = rendered(
      doc(
        paragraph(
          { type: "mention", attrs: { id: "m-1", label: "Priya" } },
          text(" can you take this?"),
        ),
      ),
    );
    expect(card(html)).toContain("@Priya");
    expect(part).toContain("@Priya can you take this?");
  });

  it("renders a document off the allow-list as escaped text, never as its markup", () => {
    const { html, text: part } = rendered(
      doc(
        { type: "script", content: [text("alert(1)")] },
        {
          type: "paragraph",
          attrs: { onclick: "alert(2)" },
          content: [text("Hello")],
        },
      ),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(card(html)).toContain("alert(1) Hello");
    expect(part).toContain("alert(1) Hello");
  });

  it("says nothing for a value that is not a document at all", () => {
    for (const value of [null, "<b>hi</b>", 42, { type: "doc" }]) {
      const { html } = rendered(value);
      expect(html, String(value)).not.toContain("<b>hi</b>");
    }
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
