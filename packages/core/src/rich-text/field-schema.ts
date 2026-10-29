/**
 * The input schema for a rich text field (docs/design/guided-inputs.md §4.7).
 *
 * Every action that takes editor JSON took it through its own copy of the
 * same refinement. This is that refinement once, with the length limit the
 * textareas these fields replaced held only in the browser. The limit counts
 * through `richTextLength` in `@openokr/formats`, which the editor's counter
 * uses too, so the field and the server agree on how long a document is.
 */
import { richTextLength } from "@openokr/formats";
import { z } from "zod";
import { RICH_TEXT_SCHEMA_VERSION } from "./schema.ts";
import { isValidRichText } from "./validate.ts";

/**
 * The JSON Schema keyword that marks a rich text field.
 *
 * The converted schema of an `unknown` field is empty, so nothing else tells a
 * reader of the contract that the field wants editor JSON. The agent catalogue
 * reads the marker to describe the field, and its dispatcher to turn an
 * agent's plain text into a document (mcp-audit-2026-10-29, finding 1). REST
 * and the command line still refuse plain text, as 0.4 decided
 * (guided-inputs.md change 13b).
 */
export const RICH_TEXT_MARKER = "x-openokr-rich-text";

const RICH_TEXT_DESCRIPTION =
  'Editor JSON: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}.';

/** Marks a schema as a rich text field, for the contract's readers. */
export function markedAsRichText<T extends z.ZodType>(schema: T): T {
  return schema.meta({
    description: RICH_TEXT_DESCRIPTION,
    [RICH_TEXT_MARKER]: true,
  });
}

export function richTextSchema(options: { maxCharacters?: number } = {}) {
  return markedAsRichText(documentSchema(options));
}

function documentSchema(options: { maxCharacters?: number }) {
  const { maxCharacters } = options;
  return z
    .unknown()
    .refine(
      (value) =>
        value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
      { message: "not valid editor JSON for the current rich text schema" },
    )
    .superRefine((value, context) => {
      if (maxCharacters === undefined || value === null) {
        return;
      }
      const length = richTextLength(value);
      if (length > maxCharacters) {
        context.addIssue({
          code: "custom",
          message: `Keep it to ${maxCharacters} characters. This has ${length}.`,
        });
      }
    });
}
