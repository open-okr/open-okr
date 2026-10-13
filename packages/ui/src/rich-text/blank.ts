import { richTextAsLine } from "@openokr/formats";

/**
 * Whether a document says nothing, so a field that must be written can say
 * so before a round trip. Text, a mention, a link to something and an
 * attachment are all something written; an editor emptied by hand, which
 * leaves one empty paragraph, and a run of spaces are not. It reads the
 * document as the length limit and an excerpt do (`richTextAsLine`).
 */
export function isBlankDocument(document: unknown): boolean {
  return richTextAsLine(document) === "";
}
