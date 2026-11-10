/**
 * The excerpt utility (docs/design/rich-text-editor.md §4): a plain-text
 * summary for the inbox and the feed's own row previews (neither exists
 * yet — built ahead of its consumer, the same position several Phase 2
 * utilities already sit in).
 */
import { richTextAsLine, textOfRichTextNode } from "@openokr/formats";
import {
  isAllowedLinkHref,
  type RichTextDocument,
  type RichTextNode,
} from "./schema.ts";

export interface ExcerptResolvers {
  resolveMention?(id: string): { readonly name: string } | undefined;
}

/** The member's current name for a mention, where the caller resolves it.
 * The walk itself lives in `@openokr/formats`, so the length limit and the
 * editor's counter read a document exactly as an excerpt does
 * (docs/design/guided-inputs.md §4.7). */
function mentionNameFrom(resolvers: ExcerptResolvers) {
  return (id: string) => resolvers.resolveMention?.(id)?.name;
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
  return truncate(richTextAsLine(doc, mentionNameFrom(resolvers)), maxLength);
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
 * The same walk, applied per top-level node instead of once over all
 * of them, so this is the same parser rather than a second one.
 */
export function plainTextLines(
  doc: RichTextDocument,
  resolvers: ExcerptResolvers = {},
): string[] {
  return doc.content
    .map((node) =>
      textOfRichTextNode(node, mentionNameFrom(resolvers))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line !== "");
}

export interface PlainTextResolvers extends ExcerptResolvers {
  /**
   * The address written after a linked phrase, or undefined for the words
   * alone. Without it every link reads as its words, which is right where
   * the address could not be followed anyway.
   */
  linkHref?(href: string): string | undefined;
}

const children = (node: RichTextNode): readonly RichTextNode[] =>
  "content" in node && node.content ? node.content : [];

const filled = (text: string): boolean => text.trim() !== "";

/** A paragraph's own text: each line's spaces collapsed, line breaks kept. */
function inlineText(
  nodes: readonly RichTextNode[],
  resolvers: PlainTextResolvers,
): string {
  // A link the editor split across differently formatted runs is one
  // phrase, so the runs are joined first and its address written once.
  const runs: { text: string; readonly href: string | undefined }[] = [];
  for (const node of nodes) {
    const link =
      node.type === "text"
        ? node.marks?.find((mark) => mark.type === "link")
        : undefined;
    const href =
      link?.type === "link" && isAllowedLinkHref(link.attrs.href)
        ? resolvers.linkHref?.(link.attrs.href)
        : undefined;
    const text =
      node.type === "hardBreak"
        ? "\n"
        : textOfRichTextNode(node, mentionNameFrom(resolvers));
    const last = runs.at(-1);
    if (href !== undefined && last?.href === href) {
      last.text += text;
    } else {
      runs.push({ text, href });
    }
  }
  return runs
    .map((run) =>
      run.href === undefined || run.text === run.href
        ? run.text
        : `${run.text} (${run.href})`,
    )
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
}

/** Every line but the first moved right, under the text after a marker. */
const hang = (text: string, by: number): string =>
  text.replaceAll("\n", `\n${" ".repeat(by)}`);

function blockText(node: RichTextNode, resolvers: PlainTextResolvers): string {
  const inner = (separator: string) =>
    children(node)
      .map((child) => blockText(child, resolvers))
      .filter(filled)
      .join(separator);
  switch (node.type) {
    case "paragraph":
    case "heading":
      return inlineText(children(node), resolvers);
    case "codeBlock":
      // Spacing is the content in code, so nothing is collapsed.
      return textOfRichTextNode(node);
    case "bulletList":
    case "orderedList":
      return children(node)
        .map((item, index) => {
          const marker = node.type === "orderedList" ? `${index + 1}. ` : "- ";
          const body = children(item)
            .map((child) => blockText(child, resolvers))
            .filter(filled)
            .join("\n");
          return hang(`${marker}${body}`, marker.length);
        })
        .join("\n");
    case "blockquote":
      return inner("\n\n")
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "table":
      return children(node)
        .map((row) =>
          children(row)
            .map((cell) =>
              children(cell)
                .map((child) => blockText(child, resolvers))
                .filter(filled)
                .join(" "),
            )
            .join(" | "),
        )
        .join("\n");
    default:
      return textOfRichTextNode(node, mentionNameFrom(resolvers));
  }
}

/**
 * The document as a plain-text part reads it (plan 0.7.0, R3): one string
 * per block, with a paragraph's line breaks kept, each list item on its own
 * line after a dash or its number and nested items moved right, a
 * quotation marked with `>`, and a table row's cells joined by a bar. Blank
 * blocks are left out.
 *
 * Text, mentions, links to things and attachments read exactly as the
 * excerpt reads them, through the same walk; what this adds is where the
 * blocks end and, where the caller can follow it, a link's address.
 */
export function plainTextBlocks(
  doc: RichTextDocument,
  resolvers: PlainTextResolvers = {},
): string[] {
  return doc.content.map((node) => blockText(node, resolvers)).filter(filled);
}
