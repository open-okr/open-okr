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
