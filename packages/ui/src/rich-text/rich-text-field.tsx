"use client";

import { type ReactNode, useId, useState } from "react";
import { useRefusedField } from "../forms/refused-fields.tsx";
import { cn } from "../lib/cn.ts";
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
  /**
   * No visible legend, where a heading beside the field already names it.
   * The editing surface keeps the label as its accessible name, as the
   * kit's other fields do.
   */
  readonly hideLabel?: boolean;
  /**
   * What the server refused about this field. Without it, the nearest
   * `RefusedFields` says it by the field's `name` (guided-inputs §4.2).
   */
  readonly error?: string | null;
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
  hideLabel = false,
  error: givenError,
}: RichTextFieldProps) {
  // A message passed in wins; otherwise the nearest `RefusedFields` says
  // what the server refused about this field (guided-inputs §4.2, plan U1b).
  const refused = useRefusedField(name);
  const error = givenError ?? refused ?? null;
  const [edited, setEdited] = useState<string | null>(() =>
    sendUnchanged && content !== null && content !== undefined
      ? JSON.stringify(content)
      : null,
  );
  const fieldId = useId();
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter((id) => id !== null)
      .join(" ") || undefined;

  return (
    // A fieldset and its legend, because the editing surface is a
    // content-editable box: it takes its name from the editor's own
    // `aria-label`, and a `label` element has no control to point at.
    <fieldset
      className="m-0 flex flex-col gap-1 border-0 p-0"
      aria-describedby={describedBy}
    >
      {hideLabel ? null : (
        <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      )}
      {/* About four lines tall before anything is typed: a one-line box
          for a diagnosis or a narrative read as a title field (usability
          review C4). */}
      <div
        className={cn(
          "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line [&_.ProseMirror]:min-h-20",
          error ? "border-bad-dot" : null,
        )}
      >
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
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
