import type { RichTextDocument } from "./schema.ts";

/**
 * Plain text into an editor document (P3-T04).
 *
 * Rich text is stored as editor JSON and never as Markdown, so a surface that
 * collects prose in a plain textarea still has to produce a document. Doing it
 * here rather than in each of those surfaces is the same rule the rest of this
 * module follows: one place parses, validates, renders and excerpts, and now one
 * place constructs.
 *
 * Blank lines separate paragraphs and nothing is interpreted: an asterisk stays
 * an asterisk. Treating the input as Markdown would make the storage format
 * depend on what somebody happened to type.
 */
export function richTextFromPlainText(text: string): RichTextDocument {
  const paragraphs = text
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  return {
    type: "doc",
    content: paragraphs.map((block) => ({
      type: "paragraph",
      content: [{ type: "text", text: block }],
    })),
  } as RichTextDocument;
}

/** True for text that would produce a document with no paragraphs at all. */
export const isBlankText = (text: string): boolean => text.trim() === "";
