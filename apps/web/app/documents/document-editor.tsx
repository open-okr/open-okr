"use client";

import type { RichTextDocument } from "@openokr/core";
import { RichTextEditor, type RichTextEditorHandle } from "@openokr/ui";
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
  body,
  state,
  canEdit,
  onSave,
  onPublish,
}: {
  readonly body: unknown;
  readonly state: "draft" | "published";
  readonly canEdit: boolean;
  readonly onSave: (body: RichTextDocument | null) => Promise<WriteState>;
  readonly onPublish: () => Promise<WriteState>;
}) {
  const editor = useRef<RichTextEditorHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<WriteState>, thenSaved: boolean) => {
    setError(null);
    setSaved(false);
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
        content={body ?? null}
        editable={canEdit}
        placeholder="What is the plan?"
      />

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (editor.current?.hasUploadsInProgress()) {
                setError("A file is still uploading. Give it a moment.");
                return;
              }
              // The editor hands back `unknown`, and the action validates it
              // again at the boundary. The cast is the one place those two
              // meet; a wrong shape is refused there, not silently stored.
              const next = (editor.current?.getJSON() ??
                null) as RichTextDocument | null;
              run(() => onSave(next), true);
            }}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:border-brand disabled:text-ink-4"
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(onPublish, false)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand disabled:bg-raised disabled:text-ink-4"
          >
            {state === "draft" ? "Publish" : "Publish a new version"}
          </button>
          {saved ? (
            <span className="text-xs text-ink-3">
              Saved. Not published yet.
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
