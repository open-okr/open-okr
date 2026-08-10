import { describe, expect, test } from "vitest";
import { excerptRichText } from "../src/rich-text/excerpt.ts";
import {
  extractAttachments,
  extractMentionIds,
} from "../src/rich-text/extract.ts";
import { renderRichTextToHtml } from "../src/rich-text/render.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../src/rich-text/schema.ts";
import {
  isValidRichText,
  parseRichText,
  RichTextValidationError,
} from "../src/rich-text/validate.ts";

/**
 * Golden documents: every one here is the contract every later module
 * builds on (P2-T11's own "watch out"). Adding a node type later means
 * adding a golden document here, not editing an existing one.
 */
const GOLDEN_DOCUMENTS: Record<string, unknown> = {
  simpleParagraph: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello, world." }],
      },
    ],
  },
  emptyParagraph: {
    type: "doc",
    content: [{ type: "paragraph" }],
  },
  headingAndMarks: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Title" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold ", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
    ],
  },
  lists: {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "one" }] },
            ],
          },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "two" }] },
            ],
          },
        ],
      },
    ],
  },
  table: {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "A" }] },
                ],
              },
              {
                type: "tableHeader",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "B" }] },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "1" }] },
                ],
              },
              {
                type: "tableCell",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "2" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  codeBlock: {
    type: "doc",
    content: [
      { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
    ],
  },
  mentionEntityLinkAttachment: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hi " },
          { type: "mention", attrs: { id: "member-1", label: "Ada" } },
          { type: "text", text: ", see " },
          {
            type: "entityLink",
            attrs: { shortId: "abc123", label: "Q3 Growth" },
          },
          { type: "text", text: " and " },
          {
            type: "attachment",
            attrs: {
              blobId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
              filename: "plan.pdf",
              contentType: "application/pdf",
              status: "ready",
            },
          },
        ],
      },
    ],
  },
  blockquoteAndRule: {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "quoted" }] },
        ],
      },
      { type: "horizontalRule" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "after" },
          { type: "hardBreak" },
          { type: "text", text: "break" },
        ],
      },
    ],
  },
};

describe("parseRichText: golden round trip", () => {
  for (const [name, doc] of Object.entries(GOLDEN_DOCUMENTS)) {
    test(name, () => {
      const parsed = parseRichText(doc, RICH_TEXT_SCHEMA_VERSION);
      // Round trip: parsing does not mutate or reshape the document —
      // the stored JSON and the validated JSON are the same value.
      expect(parsed).toStrictEqual(doc);
    });
  }
});

describe("parseRichText: rejects what is not on the allow-list", () => {
  test("an unknown node type", () => {
    const doc = {
      type: "doc",
      content: [{ type: "video", attrs: { src: "x" } }],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("an unknown mark type", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "underline" }] },
          ],
        },
      ],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("a javascript: link — the malicious-payload case", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("a heading level outside 1-3", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 5 },
          content: [{ type: "text", text: "x" }],
        },
      ],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("a tableRow directly inside a paragraph — wrong nesting, not just a wrong type", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "tableRow", content: [] }] },
      ],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("marks on codeBlock text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
        },
      ],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("an unknown schema version", () => {
    expect(() => parseRichText(GOLDEN_DOCUMENTS.simpleParagraph, 999)).toThrow(
      RichTextValidationError,
    );
  });

  test("isValidRichText is a boolean-returning sibling of the same check", () => {
    expect(
      isValidRichText(
        GOLDEN_DOCUMENTS.simpleParagraph,
        RICH_TEXT_SCHEMA_VERSION,
      ),
    ).toBe(true);
    expect(
      isValidRichText(
        { type: "doc", content: [{ type: "video" }] },
        RICH_TEXT_SCHEMA_VERSION,
      ),
    ).toBe(false);
  });
});

describe("renderRichTextToHtml: a sanitising allow-list, not a passthrough", () => {
  test("escapes text content instead of injecting it raw", () => {
    const doc = parseRichText(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "<script>alert(1)</script>" }],
          },
        ],
      },
      RICH_TEXT_SCHEMA_VERSION,
    );
    const html = renderRichTextToHtml(doc);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("golden documents render without throwing and only emit allow-listed tags", () => {
    for (const doc of Object.values(GOLDEN_DOCUMENTS)) {
      const html = renderRichTextToHtml(
        parseRichText(doc, RICH_TEXT_SCHEMA_VERSION),
      );
      expect(html).not.toMatch(/<(script|iframe|object|embed|style)/i);
    }
  });

  test("a mention with no resolver falls back to its stored label", () => {
    const doc = parseRichText(
      GOLDEN_DOCUMENTS.mentionEntityLinkAttachment,
      RICH_TEXT_SCHEMA_VERSION,
    );
    const html = renderRichTextToHtml(doc);
    expect(html).toContain("@Ada");
    expect(html).toContain("Q3 Growth");
    expect(html).toContain("plan.pdf");
  });

  test("a mention with a resolver uses the live name instead of the stored label", () => {
    const doc = parseRichText(
      GOLDEN_DOCUMENTS.mentionEntityLinkAttachment,
      RICH_TEXT_SCHEMA_VERSION,
    );
    const html = renderRichTextToHtml(doc, {
      resolveMention: () => ({ name: "Ada Lovelace (renamed)" }),
    });
    expect(html).toContain("@Ada Lovelace (renamed)");
  });

  test("an uploading attachment never renders as a link, resolver or not", () => {
    const doc = parseRichText(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "attachment",
                attrs: {
                  filename: "draft.png",
                  contentType: "image/png",
                  status: "uploading",
                },
              },
            ],
          },
        ],
      },
      RICH_TEXT_SCHEMA_VERSION,
    );
    const html = renderRichTextToHtml(doc, {
      resolveAttachment: () => ({ href: "/blobs/x" }),
    });
    expect(html).not.toContain("<a");
    expect(html).toContain("draft.png");
  });
});

describe("excerptRichText", () => {
  test("strips formatting to plain text", () => {
    const doc = parseRichText(
      GOLDEN_DOCUMENTS.headingAndMarks,
      RICH_TEXT_SCHEMA_VERSION,
    );
    expect(excerptRichText(doc, 200)).toBe("Title bold link");
  });

  test("truncates on a word boundary", () => {
    const doc = parseRichText(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "one two three four five" }],
          },
        ],
      },
      RICH_TEXT_SCHEMA_VERSION,
    );
    expect(excerptRichText(doc, 13)).toBe("one two…");
  });

  test("renders a mention as @name", () => {
    const doc = parseRichText(
      GOLDEN_DOCUMENTS.mentionEntityLinkAttachment,
      RICH_TEXT_SCHEMA_VERSION,
    );
    expect(excerptRichText(doc, 200)).toContain("@Ada");
  });
});

describe("extractMentionIds / extractAttachments: decode-safe", () => {
  test("finds every mention id in a valid document", () => {
    expect(
      extractMentionIds(GOLDEN_DOCUMENTS.mentionEntityLinkAttachment),
    ).toEqual(["member-1"]);
  });

  test("finds every attachment with its status", () => {
    expect(
      extractAttachments(GOLDEN_DOCUMENTS.mentionEntityLinkAttachment),
    ).toEqual([
      { blobId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", status: "ready" },
    ]);
  });

  test("malformed content yields an empty list, never a thrown error — mentions", () => {
    expect(extractMentionIds(null)).toEqual([]);
    expect(extractMentionIds("not an object")).toEqual([]);
    expect(extractMentionIds({ type: "doc", content: "not an array" })).toEqual(
      [],
    );
    expect(extractMentionIds({ circular: {} as unknown })).toEqual([]);
  });

  test("malformed content yields an empty list, never a thrown error — attachments", () => {
    expect(extractAttachments(undefined)).toEqual([]);
    expect(extractAttachments(42)).toEqual([]);
  });

  test("an attachment missing blobId while uploading extracts with blobId undefined", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "attachment",
          attrs: { filename: "x", contentType: "y", status: "uploading" },
        },
      ],
    };
    expect(extractAttachments(doc)).toEqual([
      { blobId: undefined, status: "uploading" },
    ]);
  });
});
