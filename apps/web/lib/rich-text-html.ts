import {
  isValidRichText,
  parseRichText,
  RICH_TEXT_SCHEMA_VERSION,
  type RichTextResolvers,
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
export function richTextHtml(
  document: unknown,
  resolvers?: RichTextResolvers,
): string | null {
  if (
    isBlankDocument(document) ||
    !isValidRichText(document, RICH_TEXT_SCHEMA_VERSION)
  ) {
    return null;
  }
  return renderRichTextToHtml(
    parseRichText(document, RICH_TEXT_SCHEMA_VERSION),
    resolvers,
  );
}

/**
 * A ready file in the text links to the download route, which decides who may
 * open it (docs/design/rich-text-editor.md §11 D14).
 *
 * Only for text that records its files: a comment and a document. Elsewhere a
 * file in the text has no row, so the link would answer not-found to every
 * reader but its uploader, and the filename alone is the honest thing to draw.
 */
export const FILE_LINKS: RichTextResolvers = {
  resolveAttachment: (blobId) => ({
    href: `/api/blobs/${encodeURIComponent(blobId)}`,
  }),
};
