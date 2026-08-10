/**
 * The canonical rich-text schema (docs/design/rich-text-editor.md §2-3,
 * P2-T11). TipTap's own document JSON shape, restricted to an explicit
 * node and mark allow-list — never a custom shape, and never Markdown.
 *
 * This file only defines *what a node or mark looks like*. Whether a given
 * node type is allowed to sit inside a given parent (a `tableRow` may not
 * sit directly inside a `paragraph`) is `validate.ts`'s job, via
 * `NESTING_RULES` below — attribute shape and tree structure are two
 * different questions, and keeping them in two passes is what lets each
 * one have a precise, readable error of its own.
 */
import { z } from "zod";

/** Bumped only when this allow-list itself changes in a way old stored
 * documents cannot already satisfy. See the design doc §2: there is
 * nothing to migrate from yet, so this exists for the future, not for
 * today's reader. */
export const RICH_TEXT_SCHEMA_VERSION = 1;

const ALLOWED_LINK_PROTOCOLS = ["http:", "https:", "mailto:"] as const;

/** Never trusts a bare string as "relative enough to be safe" — an
 * `href` with no parseable protocol is rejected the same as one with an
 * unlisted one. `javascript:` and every other scheme are refused this way
 * without needing to name them. */
export function isAllowedLinkHref(href: string): boolean {
  try {
    const url = new URL(href, "https://placeholder.invalid");
    return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(url.protocol);
  } catch {
    return false;
  }
}

const linkMarkSchema = z.object({
  type: z.literal("link"),
  attrs: z.object({
    href: z.string().refine(isAllowedLinkHref, {
      message: "href must be http:, https: or mailto:",
    }),
  }),
});

export const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("strike") }),
  linkMarkSchema,
]);

export type Mark = z.infer<typeof markSchema>;

export const marksArraySchema = z.array(markSchema).optional();

/** Attribute schemas per node type. A node type absent from this map (and
 * absent from `LEAF_NODE_TYPES`/container handling in `validate.ts`) is
 * simply not on the allow-list — there is no default-accept path. */
export const NODE_ATTRS_SCHEMAS = {
  doc: z.undefined(),
  paragraph: z.undefined(),
  heading: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  bulletList: z.undefined(),
  orderedList: z.undefined(),
  listItem: z.undefined(),
  codeBlock: z.undefined(),
  table: z.undefined(),
  tableRow: z.undefined(),
  tableCell: z.undefined(),
  tableHeader: z.undefined(),
  blockquote: z.undefined(),
  horizontalRule: z.undefined(),
  hardBreak: z.undefined(),
  mention: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  entityLink: z.object({
    shortId: z.string().min(1),
    label: z.string().min(1),
  }),
  attachment: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(1),
    status: z.union([z.literal("uploading"), z.literal("ready")]),
    // Absent while `status` is "uploading" — nothing to reference yet.
    blobId: z.string().uuid().optional(),
  }),
} as const;

export type NodeType = keyof typeof NODE_ATTRS_SCHEMAS;

export const NODE_TYPES = Object.keys(
  NODE_ATTRS_SCHEMAS,
) as readonly NodeType[];

/** Atomic, childless nodes. Leaves in the tree, same as `text`, but with
 * no `text` field of their own — their content is entirely their attrs. */
export const LEAF_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "horizontalRule",
  "hardBreak",
  "mention",
  "entityLink",
  "attachment",
]);

/** Inline content: what may appear inside a `paragraph` or `heading`
 * alongside `text`. */
export const INLINE_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "mention",
  "entityLink",
  "attachment",
  "hardBreak",
]);

/**
 * What a container node type may hold, one level down. `"inline"` means
 * `text` plus anything in `INLINE_NODE_TYPES`. A node type not listed here
 * and not in `LEAF_NODE_TYPES` (today: only `text` itself, handled
 * separately in `validate.ts`) has no valid children at all.
 */
export const NESTING_RULES: Readonly<
  Record<string, readonly NodeType[] | "inline">
> = {
  doc: [
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "codeBlock",
    "table",
    "blockquote",
    "horizontalRule",
  ],
  paragraph: "inline",
  heading: "inline",
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  listItem: [
    "paragraph",
    "bulletList",
    "orderedList",
    "codeBlock",
    "blockquote",
  ],
  blockquote: [
    "paragraph",
    "bulletList",
    "orderedList",
    "codeBlock",
    "heading",
  ],
  table: ["tableRow"],
  tableRow: ["tableCell", "tableHeader"],
  tableCell: ["paragraph", "bulletList", "orderedList", "codeBlock"],
  tableHeader: ["paragraph", "bulletList", "orderedList", "codeBlock"],
  // `codeBlock` holds plain text only: no marks, no nested nodes. Modelled
  // as its own case in validate.ts rather than a NESTING_RULES entry,
  // since "text with no marks" is a different check than "text or these
  // inline node types".
};

export interface RichTextTextNode {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly Mark[];
}

export interface RichTextElementNode {
  readonly type: NodeType;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly RichTextNode[];
}

export type RichTextNode = RichTextTextNode | RichTextElementNode;

export interface RichTextDocument {
  readonly type: "doc";
  readonly content: readonly RichTextNode[];
}
