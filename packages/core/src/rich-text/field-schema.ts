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

export function richTextSchema(options: { maxCharacters?: number } = {}) {
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
