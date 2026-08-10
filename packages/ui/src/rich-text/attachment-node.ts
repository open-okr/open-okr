/**
 * The `attachment` node (docs/design/rich-text-editor.md §7). Atomic,
 * inline, a reference to a blob rather than a copy of one — `blobId` is
 * absent while `status` is `"uploading"`, filled in once the caller's own
 * upload function (a prop, not an import: `packages/ui` has no reach into
 * P2-T05's blob pipeline) resolves.
 */
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AttachmentView } from "./attachment-view.tsx";

export type AttachmentStatus = "uploading" | "ready";

export interface AttachmentAttrs {
  readonly filename: string;
  readonly contentType: string;
  readonly status: AttachmentStatus;
  readonly blobId?: string;
}

export const Attachment = Node.create({
  name: "attachment",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      filename: { default: "" },
      contentType: { default: "" },
      status: { default: "uploading" },
      blobId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-attachment-node="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-attachment-node": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});
