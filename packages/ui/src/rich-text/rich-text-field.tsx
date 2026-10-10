"use client";

import { type ReactNode, useId, useState } from "react";
import { RichTextEditor } from "./editor.tsx";

export interface RichTextFieldProps {
  readonly label: string;
  /** The form field the document is submitted as, written as JSON. */
  readonly name: string;
  /** The stored document, or null for none. */
  readonly content?: unknown;
  readonly description?: ReactNode;
  readonly placeholder?: string;
  /** The most characters it takes, counted as the server counts them. */
  readonly maxCharacters?: number;
  /**
   * For a form whose action writes every field on each save, as the cycle's
   * forms do: the stored document is sent as it is, so the action can tell a
   * field kept as it was from an empty one. An empty field still sends
   * nothing.
   */
  readonly sendUnchanged?: boolean;
}

/**
 * A rich text field in an ordinary form (docs/design/guided-inputs.md §4.7):
 * the compact editor under a visible label, writing its document into a
 * hidden input named after the field, so a server action reads it like any
 * other field.
 *
 * **Sent only once it is edited**, unless `sendUnchanged` says otherwise. Each
 * save of a rich text field writes a new version of it, so a form that sent
 * an untouched field would version something nobody changed. An action reads
 * an absent field as "leave it".
 */
export function RichTextField({
  label,
  name,
  content,
  description,
  placeholder,
  maxCharacters,
  sendUnchanged = false,
}: RichTextFieldProps) {
  const [edited, setEdited] = useState<string | null>(() =>
    sendUnchanged && content !== null && content !== undefined
      ? JSON.stringify(content)
      : null,
  );
  const descriptionId = `${useId()}-description`;

  return (
    // A fieldset and its legend, because the editing surface is a
    // content-editable box: it takes its name from the editor's own
    // `aria-label`, and a `label` element has no control to point at.
    <fieldset
      className="m-0 flex flex-col gap-1 border-0 p-0"
      aria-describedby={description ? descriptionId : undefined}
    >
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      <div className="rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line">
        <RichTextEditor
          label={label}
          variant="compact"
          content={content ?? null}
          placeholder={placeholder}
          maxCharacters={maxCharacters}
          onUpdate={(json) => setEdited(JSON.stringify(json))}
        />
      </div>
      {edited === null ? null : (
        <input type="hidden" name={name} value={edited} />
      )}
      {description ? (
        <p id={descriptionId} className="text-xs text-ink-3">
          {description}
        </p>
      ) : null}
    </fieldset>
  );
}
