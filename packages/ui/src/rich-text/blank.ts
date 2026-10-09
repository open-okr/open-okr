interface ContentNode {
  readonly type?: string;
  readonly content?: readonly unknown[];
}

/**
 * Whether a document holds nothing but empty paragraphs, so a field that must
 * be written can say so before a round trip. Text, a mention, a link to
 * something or an attachment are all something written; an editor emptied by
 * hand leaves a document with one empty paragraph in it, which is not.
 */
export function isBlankDocument(document: unknown): boolean {
  const visit = (node: ContentNode): boolean => {
    if (node.type !== "doc" && node.type !== "paragraph" && !node.content) {
      return false;
    }
    return (node.content ?? []).every((child) => visit(child as ContentNode));
  };
  if (document === null || typeof document !== "object") {
    return true;
  }
  return visit(document as ContentNode);
}
