"use client";

import type { RichTextDocument } from "@openokr/core";
import {
  guardPress,
  RichTextEditor,
  type RichTextEditorHandle,
  Spinner,
  useTranslations,
} from "@openokr/ui";
import { useRef, useState, useTransition } from "react";
import type { WriteState } from "../cycle/write-state.ts";

/**
 * Editing a document, and publishing it (S-29, P5-T12).
 *
 * **Save and publish are two buttons because they are two decisions.** Saving
 * keeps the words; publishing is when anybody else hears about it and when a
 * version is written. A single button would make somebody publish a half-formed
 * plan to keep their work.
 *
 * The editor is the shared one, so the schema, the sanitising and the excerpt
 * this document is searched by all come from the same module.
 */
export function DocumentEditor({
  title,
  body,
  state,
  canEdit,
  onSave,
  onPublish,
}: {
  /** The document's own title names the editor, which is what a screen
   * reader user needs to hear when they land in it. */
  readonly title: string;
  readonly body: unknown;
  readonly state: "draft" | "published";
  readonly canEdit: boolean;
  readonly onSave: (body: RichTextDocument | null) => Promise<WriteState>;
  readonly onPublish: () => Promise<WriteState>;
}) {
  const { t } = useTranslations();

  const editor = useRef<RichTextEditorHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // Which button started the write in flight, so only that one spins.
  const [acting, setActing] = useState<string | null>(null);

  const run = (
    name: string,
    fn: () => Promise<WriteState>,
    thenSaved: boolean,
  ) => {
    setError(null);
    setSaved(false);
    setActing(name);
    startTransition(async () => {
      const outcome = await fn();
      if (outcome.error) {
        setError(outcome.error);
        return;
      }
      setSaved(thenSaved);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <RichTextEditor
        ref={editor}
        label={title}
        content={body ?? null}
        editable={canEdit}
        placeholder={t("documents.documentEditor.whatIsThePlan")}
      />

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Refused with `aria-disabled`, not `disabled`, so the pressed button
           * keeps keyboard focus while the write is sent; see `guardPress`. */}
          <button
            type="button"
            aria-disabled={pending || undefined}
            aria-busy={(pending && acting === "save") || undefined}
            onClick={guardPress(pending, () => {
              if (editor.current?.hasUploadsInProgress()) {
                setError(t("documents.documentEditor.fileStillUploading"));
                return;
              }
              // The editor hands back `unknown`, and the action validates it
              // again at the boundary. The cast is the one place those two
              // meet; a wrong shape is refused there, not silently stored.
              const next = (editor.current?.getJSON() ??
                null) as RichTextDocument | null;
              run("save", () => onSave(next), true);
            })}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:border-brand disabled:text-ink-4 aria-disabled:text-ink-4"
          >
            {pending && acting === "save" ? <Spinner /> : null}
            <span>{t("common.save")}</span>
          </button>
          <button
            type="button"
            aria-disabled={pending || undefined}
            aria-busy={(pending && acting === "publish") || undefined}
            onClick={guardPress(pending, () =>
              run("publish", onPublish, false),
            )}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand disabled:bg-raised disabled:text-ink-4 aria-disabled:bg-raised aria-disabled:text-ink-4"
          >
            {pending && acting === "publish" ? <Spinner /> : null}
            <span>
              {state === "draft"
                ? t("checkIn.composer.publish")
                : t("documents.documentEditor.publishANewVersion")}
            </span>
          </button>
          {saved ? (
            <span className="text-xs text-ink-3">
              {t("documents.documentEditor.savedNotPublishedYet")}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
