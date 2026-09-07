"use client";

import { useState, useTransition } from "react";
import type { WriteState } from "../cycle/write-state.ts";

/**
 * A select that saves on change, and says so when it cannot (S-26, P5-T10b).
 *
 * **The refusal is the reason this is a component rather than a form.** A
 * select that reverted silently would tell a reader who lacks edit access
 * nothing at all, and the sentence they need ("initiatives.update needs a
 * higher access level than you hold") is already written in `packages/core`.
 * So the value is held locally, sent, and put back with the message beside it
 * when the server refuses.
 *
 * `disabled` covers the reader who cannot edit at all. It is a separate state
 * from a refusal: one is known before the click and the other after it, and
 * showing a control somebody cannot use is worse than not showing it.
 */
export function InlineSelect({
  label,
  value,
  options,
  disabled,
  onSave,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly disabled?: boolean;
  readonly onSave: (next: string) => Promise<WriteState>;
}) {
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col gap-1">
      <select
        aria-label={label}
        className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink disabled:text-ink-3"
        value={current}
        disabled={disabled || pending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = current;
          setCurrent(next);
          setError(null);
          startTransition(async () => {
            const state = await onSave(next);
            if (state.error) {
              setCurrent(previous);
              setError(state.error);
            }
          });
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
