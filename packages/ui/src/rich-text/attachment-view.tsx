"use client";

import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { Loader2, Paperclip, X } from "lucide-react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import type { AttachmentAttrs } from "./attachment-node.ts";

/** The node view for `attachment` (§7): a filename with a spinner while
 * `status` is "uploading", or a plain reference once "ready" — never a
 * link inside the editor itself, since the live href only exists once
 * this document is rendered somewhere with a resolver (`render.ts`'s
 * job, not the editor's).
 *
 * Its words are translated, and the remove button is drawn only where the
 * text can be changed (plan 0.7.0 R4, when a person could first put a file
 * here). */
export function AttachmentView({
  node,
  deleteNode,
  selected,
  editor,
}: ReactNodeViewProps) {
  const { t } = useTranslations();
  const attrs = node.attrs as AttachmentAttrs;

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-line-2 bg-raised px-1.5 py-0.5 text-xs text-ink-2",
        selected && "outline-2 outline-brand",
      )}
      data-attachment-node="true"
      data-status={attrs.status}
    >
      {attrs.status === "uploading" ? (
        <Loader2
          className="size-3 flex-none animate-spin text-ink-4"
          role="img"
          aria-label={t("editor.attachment.uploading", {
            filename: attrs.filename,
          })}
        />
      ) : (
        <Paperclip className="size-3 flex-none text-ink-4" aria-hidden="true" />
      )}
      <span className="max-w-40 truncate">{attrs.filename}</span>
      {editor.isEditable ? (
        <button
          type="button"
          aria-label={t("editor.attachment.remove", {
            filename: attrs.filename,
          })}
          className="text-ink-4 hover:text-bad"
          onClick={deleteNode}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}
