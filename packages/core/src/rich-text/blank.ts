/**
 * A document with nothing in it: only empty paragraphs, which is what an
 * editor hands back once everything has been deleted from it.
 *
 * Structural rather than by extracting text, because a document holding only
 * a mention or an attachment has no text of its own and is still not empty.
 */
export function isBlankDocument(document: unknown): boolean {
  const content = (document as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.every((node) => {
    const block = node as { type?: unknown; content?: unknown };
    return (
      block.type === "paragraph" &&
      (!Array.isArray(block.content) || block.content.length === 0)
    );
  });
}
