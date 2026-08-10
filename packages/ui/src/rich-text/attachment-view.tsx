import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { Loader2, Paperclip, X } from "lucide-react";
import { cn } from "../lib/cn.ts";
import type { AttachmentAttrs } from "./attachment-node.ts";

/** The node view for `attachment` (§7): a filename with a spinner while
 * `status` is "uploading", or a plain reference once "ready" — never a
 * link inside the editor itself, since the live href only exists once
 * this document is rendered somewhere with a resolver (`render.ts`'s
 * job, not the editor's). */
export function AttachmentView({
  node,
  deleteNode,
  selected,
}: ReactNodeViewProps) {
  const attrs = node.attrs as AttachmentAttrs;

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-line-2 bg-raised px-1.5 py-0.5 text-xs text-ink-2",
        selected && "outline-2 outline-brand",
      )}
      data-attachment-node="true"
    >
      {attrs.status === "uploading" ? (
        <Loader2
          className="size-3 flex-none animate-spin text-ink-4"
          aria-label="Uploading"
        />
      ) : (
        <Paperclip className="size-3 flex-none text-ink-4" aria-hidden="true" />
      )}
      <span className="max-w-40 truncate">{attrs.filename}</span>
      <button
        type="button"
        aria-label={`Remove ${attrs.filename}`}
        className="text-ink-4 hover:text-bad"
        onClick={deleteNode}
      >
        <X className="size-3" />
      </button>
    </NodeViewWrapper>
  );
}
