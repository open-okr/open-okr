/**
 * Prose moved from plain text to rich text (docs/design/guided-inputs.md
 * §4.7, changes 11 to 13).
 *
 * The move took two releases. 0.3 took a document or the plain text it took
 * before, and wrote both columns; 0.4 takes and stores the document only
 * (change 13b). What is left here is what the actions still need.
 */
import { isBlankDocument } from "./blank.ts";
import { plainTextLines } from "./excerpt.ts";
import type { RichTextDocument } from "./schema.ts";

/** What a field's input means: a document as it is, and anything blank as null. */
export function documentOfInput(value: unknown): RichTextDocument | null {
  if (value === null || value === undefined || isBlankDocument(value)) {
    return null;
  }
  return value as RichTextDocument;
}

/**
 * A document as plain text: one block a paragraph, with a blank line between,
 * which is how `richTextFromPlainText` splits them.
 */
export function plainTextOfDocument(document: RichTextDocument): string {
  return plainTextLines(document).join("\n\n");
}
