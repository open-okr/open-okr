/**
 * The excerpt utility (docs/design/rich-text-editor.md §4): a plain-text
 * summary for the inbox and the feed's own row previews (neither exists
 * yet — built ahead of its consumer, the same position several Phase 2
 * utilities already sit in).
 */
import type { RichTextDocument, RichTextNode } from "./schema.ts";

export interface ExcerptResolvers {
  resolveMention?(id: string): { readonly name: string } | undefined;
}

function textOf(node: RichTextNode, resolvers: ExcerptResolvers): string {
  if (node.type === "text") {
    return node.text;
  }
  if (node.type === "mention") {
    const id = String(node.attrs?.id ?? "");
    const label = String(node.attrs?.label ?? "");
    return `@${resolvers.resolveMention?.(id)?.name ?? label}`;
  }
  if (node.type === "entityLink") {
    return String(node.attrs?.label ?? "");
  }
  if (node.type === "attachment") {
    return String(node.attrs?.filename ?? "");
  }
  if (node.type === "hardBreak" || node.type === "horizontalRule") {
    return "";
  }
  return (node.content ?? []).map((child) => textOf(child, resolvers)).join("");
}

/** Truncates on a word boundary rather than mid-word, so a name or a
 * short identifier never gets cut in half. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function excerptRichText(
  doc: RichTextDocument,
  maxLength: number,
  resolvers: ExcerptResolvers = {},
): string {
  const text = doc.content
    .map((node) => textOf(node, resolvers))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, maxLength);
}

/**
 * The document as plain text, one line per block (P5-T12).
 *
 * **`excerptRichText` collapses every whitespace run to a single space**, which
 * is right for a one-line preview and wrong for anything that wants to know
 * where a paragraph ended. The version difference is a line comparison, and
 * against a collapsed excerpt every edit reads as "the whole document changed":
 * found by publishing two versions of a two-paragraph document in a browser and
 * getting one line back.
 *
 * The same `textOf` walk, applied per top-level node instead of once over all
 * of them, so this is the same parser rather than a second one.
 */
export function plainTextLines(
  doc: RichTextDocument,
  resolvers: ExcerptResolvers = {},
): string[] {
  return doc.content
    .map((node) => textOf(node, resolvers).replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}
