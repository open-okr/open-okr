import { describe, expect, test } from "vitest";
import { excerptRichText } from "../src/rich-text/excerpt.ts";
import {
  extractAttachments,
  extractMentionIds,
} from "../src/rich-text/extract.ts";
import { richTextSchema } from "../src/rich-text/field-schema.ts";
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

  test("a horizontalRule nested inline inside a paragraph", () => {
    // horizontalRule is a leaf node (LEAF_NODE_TYPES), but not one of the
    // inline node types a paragraph/heading may hold alongside text
    // (INLINE_NODE_TYPES) — it belongs at the document level only.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before" },
            { type: "horizontalRule" },
          ],
        },
      ],
    };
    expect(() => parseRichText(doc, RICH_TEXT_SCHEMA_VERSION)).toThrow(
      RichTextValidationError,
    );
  });

  test("an unknown mark type", () => {
    // Text colour, which the allow-list still leaves out. Underline was the
    // example here until it joined the list (guided-inputs §4.7).
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "textStyle" }] },
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

/**
 * Underline, step 1 (docs/design/guided-inputs.md §4.7): every reader knows
 * the mark before anything can write it, so a document carrying one, written
 * by a later release, still validates and still renders during a rolling
 * upgrade. Nothing in this release adds the mark: not the editor's keyboard,
 * not a paste, and not the HTML import.
 */
describe("underline, which readers know before anything writes it", () => {
  const underlined = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Mind " },
          { type: "text", text: "this", marks: [{ type: "underline" }] },
        ],
      },
    ],
  };

  test("validates as a document", () => {
    expect(isValidRichText(underlined, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
  });

  test("renders as <u>, on the screen, in email and in exports alike", () => {
    const doc = parseRichText(underlined, RICH_TEXT_SCHEMA_VERSION);
    expect(renderRichTextToHtml(doc)).toContain("<u>this</u>");
  });

  test("reads as its text in an excerpt", () => {
    const doc = parseRichText(underlined, RICH_TEXT_SCHEMA_VERSION);
    expect(excerptRichText(doc, 100)).toBe("Mind this");
  });
});

describe("richTextSchema: the one input schema for a rich text field", () => {
  const words = (value: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  });

  test("takes a valid document or null, and refuses anything else", () => {
    const schema = richTextSchema();
    expect(schema.safeParse(words("Shipped")).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
    const refused = schema.safeParse({ type: "script" });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe(
      "not valid editor JSON for the current rich text schema",
    );
  });

  test("with a limit, counts what a reader sees and refuses one over it", () => {
    const schema = richTextSchema({ maxCharacters: 10 });
    const bold = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "0123456789", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    expect(schema.safeParse(bold).success).toBe(true);
    const over = schema.safeParse(words("0123456789X"));
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe(
      "Keep it to 10 characters. This has 11.",
    );
    expect(schema.safeParse(null).success).toBe(true);
  });

  test("counts the way an excerpt reads, so the two cannot disagree", () => {
    const doc = parseRichText(
      GOLDEN_DOCUMENTS.mentionEntityLinkAttachment,
      RICH_TEXT_SCHEMA_VERSION,
    );
    const length = excerptRichText(doc, 10_000).length;
    expect(
      richTextSchema({ maxCharacters: length }).safeParse(doc).success,
    ).toBe(true);
    expect(
      richTextSchema({ maxCharacters: length - 1 }).safeParse(doc).success,
    ).toBe(false);
  });
});
