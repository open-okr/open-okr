/**
 * A prose field part-way from plain text to rich text (docs/design/
 * guided-inputs.md §4.7, changes 11 to 13).
 *
 * Each such column moves over two releases. In the first, the action takes a
 * document and still takes the string it took before, so an API client or the
 * command line that sends text keeps working through the rollout (decided 13
 * October 2026). It writes both: the document, and its plain text into the old
 * column, which the previous release, still running during a rolling upgrade,
 * reads as it always did. Readers take the document, and wrap the old column
 * while the data change has not reached the row. Change 13 drops the string
 * and the old column.
 */
import { z } from "zod";
import { isBlankDocument } from "./blank.ts";
import { plainTextLines } from "./excerpt.ts";
import { richTextSchema } from "./field-schema.ts";
import { richTextFromPlainText } from "./from-text.ts";
import type { RichTextDocument } from "./schema.ts";

/** The input such a field takes: a document, or for now the plain text it took before. */
export function richTextOrPlainTextSchema(options: {
  readonly maxCharacters: number;
}) {
  return z.union([
    z.string().trim().max(options.maxCharacters),
    richTextSchema(options),
  ]);
}

/**
 * What such an input means: a string wrapped one paragraph per blank-line
 * block, a document as it is, and anything blank as null.
 */
export function documentOfInput(value: unknown): RichTextDocument | null {
  if (typeof value === "string") {
    return value.trim() === "" ? null : richTextFromPlainText(value);
  }
  if (value === null || value === undefined || isBlankDocument(value)) {
    return null;
  }
  return value as RichTextDocument;
}

/**
 * A document as the plain text its old column held: one block a paragraph,
 * with a blank line between, which is how `richTextFromPlainText` splits
 * them, so the previous release reads what it always read.
 */
export function plainTextOfDocument(document: RichTextDocument): string {
  return plainTextLines(document).join("\n\n");
}

/**
 * The document a reader shows: the stored one, or the old column wrapped while
 * the data change has not yet reached this row.
 */
export function documentOrPlainText(
  document: unknown,
  text: string | null,
): RichTextDocument | null {
  if (document !== null && typeof document === "object") {
    return document as RichTextDocument;
  }
  return text === null || text.trim() === ""
    ? null
    : richTextFromPlainText(text);
}
