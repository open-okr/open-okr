import {
  isValidRichText,
  parseRichText,
  RICH_TEXT_SCHEMA_VERSION,
  renderRichTextToHtml,
} from "@openokr/core";
import { isBlankDocument } from "@openokr/ui";

/**
 * Stored rich text as HTML for `RichTextView`, or null when there is
 * nothing to show (docs/design/guided-inputs.md §4.7).
 *
 * On the server, through core's one renderer. A document that does not
 * validate is shown as nothing rather than trusted: a stored value can have
 * arrived through an importer or a channel, and the renderer's allow-list is
 * only a promise about documents that passed the schema.
 */
export function richTextHtml(document: unknown): string | null {
  if (
    isBlankDocument(document) ||
    !isValidRichText(document, RICH_TEXT_SCHEMA_VERSION)
  ) {
    return null;
  }
  return renderRichTextToHtml(
    parseRichText(document, RICH_TEXT_SCHEMA_VERSION),
  );
}
