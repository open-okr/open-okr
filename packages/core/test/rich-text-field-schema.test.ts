import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RICH_TEXT_MARKER,
  richTextSchema,
} from "../src/rich-text/field-schema.ts";

/**
 * A rich text field says what it is in the contract.
 *
 * The converted schema of an `unknown` field was empty, so a reader of the
 * contract could not tell it wanted editor JSON (mcp-audit-2026-10-29,
 * finding 1). The marker is also what the agent dispatcher reads to accept an
 * agent's plain text. Everywhere else plain text stays refused, as 0.4 decided
 * (guided-inputs.md change 13b).
 */
describe("a rich text field", () => {
  it("carries the marker and the shape it wants in the contract", () => {
    const schema = z.toJSONSchema(richTextSchema(), {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    expect(schema[RICH_TEXT_MARKER]).toBe(true);
    expect(schema.description).toMatch(/editor JSON/i);
  });

  it("still refuses plain text outside the agent path, as 0.4 decided", () => {
    expect(richTextSchema().safeParse("Plain words").success).toBe(false);
  });

  it("keeps editor JSON as it is", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };
    expect(richTextSchema().parse(doc)).toEqual(doc);
  });
});

// rich-text-editor.md §7 promised a server check that refuses a save while a
// file is still uploading, and there was none (plan 0.7.0, R1, §11 D1).
describe("a rich text field holding a file", () => {
  // An attachment is inline, so it sits in a paragraph.
  const withFile = (attrs: Record<string, unknown>) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "attachment",
            attrs: {
              filename: "plan.pdf",
              contentType: "application/pdf",
              ...attrs,
            },
          },
        ],
      },
    ],
  });
  const UPLOADING =
    "A file in this text is still uploading. Wait for it to finish, then save.";

  it("refuses a file that is still uploading", () => {
    const result = richTextSchema().safeParse(
      withFile({ status: "uploading" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(UPLOADING);
  });

  it("refuses a file marked ready with nothing behind it", () => {
    const result = richTextSchema().safeParse(withFile({ status: "ready" }));
    expect(result.error?.issues[0]?.message).toBe(UPLOADING);
  });

  it("keeps a file that finished uploading", () => {
    const doc = withFile({
      status: "ready",
      blobId: "6a1f9c62-3d8e-4f0a-9b7c-2e5d8a4f1b30",
    });
    expect(richTextSchema().parse(doc)).toEqual(doc);
  });
});
