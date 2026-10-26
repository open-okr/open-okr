/**
 * How much a rich text document says (docs/design/guided-inputs.md §4.7).
 *
 * The editor's counter in the browser and the length limit on the server
 * count with this, so a field that says "980 of 1000" is never refused for
 * being over 1000. It reads the text the way core's excerpt has always read
 * it, and the excerpt now reads it through here, so there is one reading.
 *
 * Written against the stored JSON shape rather than core's types, which this
 * package cannot import, and safe on any value: something that is not a
 * document has no text.
 */

interface ContentNode {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: { readonly [name: string]: unknown } | null;
  readonly content?: unknown;
}

/** A mention's current name, by member id, where the caller knows it. */
export type MentionName = (id: string) => string | undefined;

function isNode(value: unknown): value is ContentNode {
  return value !== null && typeof value === "object";
}

function children(node: ContentNode): readonly unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

/**
 * The text one node holds: a text node's text, a mention as `@name`, a link
 * to something and an attachment by their names, and nothing for a line
 * break or a rule. Formatting adds nothing.
 */
export function textOfRichTextNode(
  node: unknown,
  mentionName?: MentionName,
): string {
  if (!isNode(node)) {
    return "";
  }
  const attribute = (name: string) => String(node.attrs?.[name] ?? "");
  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "mention":
      return `@${mentionName?.(attribute("id")) ?? attribute("label")}`;
    case "entityLink":
      return attribute("label");
    case "attachment":
      return attribute("filename");
    case "hardBreak":
    case "horizontalRule":
      return "";
    default:
      return children(node)
        .map((child) => textOfRichTextNode(child, mentionName))
        .join("");
  }
}

/**
 * The whole document as one line: each top-level block's text, a space
 * between them, every run of whitespace one space, the ends trimmed.
 */
export function richTextAsLine(
  document: unknown,
  mentionName?: MentionName,
): string {
  if (!isNode(document)) {
    return "";
  }
  return children(document)
    .map((block) => textOfRichTextNode(block, mentionName))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many characters a document holds, as `richTextAsLine` reads it. */
export function richTextLength(document: unknown): number {
  return richTextAsLine(document).length;
}
