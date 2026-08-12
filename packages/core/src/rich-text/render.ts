/**
 * The sanitising renderer (docs/design/rich-text-editor.md §4).
 *
 * "Rendering is a sanitising allow-list at every surface, including email
 * and exports" (P2-T11's own watch-out) means concretely: every emitted
 * HTML tag comes from `TAG_BY_NODE_TYPE` below, never a value read out of
 * the document, and every text value is escaped. A caller with no
 * database connection (a test, a preview) can call this with no
 * resolvers at all and still get safe output — degraded to plain text
 * for anything that needed a lookup, never broken or thrown.
 */
import {
  isAllowedLinkHref,
  type Mark,
  type RichTextDocument,
  type RichTextNode,
} from "./schema.ts";

export interface RichTextResolvers {
  resolveMention?(id: string): { readonly name: string } | undefined;
  resolveEntityLink?(
    shortId: string,
  ): { readonly href: string; readonly label: string } | undefined;
  resolveAttachment?(blobId: string): { readonly href: string } | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const TAG_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  paragraph: "p",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  codeBlock: "pre",
  table: "table",
  tableRow: "tr",
  tableCell: "td",
  tableHeader: "th",
  blockquote: "blockquote",
};

const MARK_TAG_BY_TYPE: Readonly<Record<string, string>> = {
  bold: "strong",
  italic: "em",
  code: "code",
  strike: "s",
};

function wrapMarks(inner: string, marks: readonly Mark[] | undefined): string {
  if (!marks || marks.length === 0) {
    return inner;
  }
  return marks.reduceRight((html, mark) => {
    if (mark.type === "link") {
      // Re-validated here, not just trusted from a document that already
      // passed parseRichText once: this function is also the one email
      // and export rendering calls, and a document's stored validity at
      // write time is not a promise it is still valid content by the
      // time something renders it — cheap to check again, expensive not to.
      if (!isAllowedLinkHref(mark.attrs.href)) {
        return html;
      }
      return `<a href="${escapeHtml(mark.attrs.href)}" rel="noopener noreferrer">${html}</a>`;
    }
    const tag = MARK_TAG_BY_TYPE[mark.type];
    return tag ? `<${tag}>${html}</${tag}>` : html;
  }, inner);
}

function renderNode(node: RichTextNode, resolvers: RichTextResolvers): string {
  if (node.type === "text") {
    return wrapMarks(escapeHtml(node.text), node.marks);
  }

  if (node.type === "hardBreak") {
    return "<br />";
  }
  if (node.type === "horizontalRule") {
    return "<hr />";
  }
  if (node.type === "mention") {
    const id = String(node.attrs?.id ?? "");
    const label = String(node.attrs?.label ?? "");
    const resolved = resolvers.resolveMention?.(id);
    return `<span class="mention">@${escapeHtml(resolved?.name ?? label)}</span>`;
  }
  if (node.type === "entityLink") {
    const shortId = String(node.attrs?.shortId ?? "");
    const label = String(node.attrs?.label ?? "");
    const resolved = resolvers.resolveEntityLink?.(shortId);
    if (resolved) {
      return `<a class="entity-link" href="${escapeHtml(resolved.href)}">${escapeHtml(resolved.label)}</a>`;
    }
    return `<span class="entity-link">${escapeHtml(label)}</span>`;
  }
  if (node.type === "attachment") {
    const status = node.attrs?.status;
    const filename = String(node.attrs?.filename ?? "");
    if (status === "ready") {
      const blobId = String(node.attrs?.blobId ?? "");
      const resolved = resolvers.resolveAttachment?.(blobId);
      if (resolved) {
        return `<a class="attachment" href="${escapeHtml(resolved.href)}">${escapeHtml(filename)}</a>`;
      }
    }
    // Still uploading, or resolution failed (a deleted blob): the
    // filename alone, never a broken link.
    return `<span class="attachment">${escapeHtml(filename)}</span>`;
  }
  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 1);
    const inner = (node.content ?? [])
      .map((child) => renderNode(child, resolvers))
      .join("");
    return `<h${level}>${inner}</h${level}>`;
  }

  const tag = TAG_BY_NODE_TYPE[node.type];
  const inner = (node.content ?? [])
    .map((child) => renderNode(child, resolvers))
    .join("");
  return tag ? `<${tag}>${inner}</${tag}>` : inner;
}

export function renderRichTextToHtml(
  doc: RichTextDocument,
  resolvers: RichTextResolvers = {},
): string {
  return doc.content.map((node) => renderNode(node, resolvers)).join("");
}
