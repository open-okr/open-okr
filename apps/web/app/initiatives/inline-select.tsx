"use client";

import { SelectInput, Spinner } from "@openokr/ui";
import { useState, useTransition } from "react";
import type { Conflict } from "../../lib/conflict.ts";
import { ConflictNotice } from "../../lib/conflict-notice.tsx";
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
 *
 * **It sends the value it was drawn with beside the new one** (D3,
 * optimistic-concurrency.md V4), so a value somebody else changed since is
 * refused rather than overwritten, and the select offers keep mine and take
 * theirs. A save that does not compare ignores it.
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
  readonly onSave: (next: string, read: string) => Promise<WriteState>;
}) {
  const [current, setCurrent] = useState(value);
  // What the select was last drawn with or saved as: the read it sends.
  const [read, setRead] = useState(value);
  // A fresh value from the page, after a save or a refresh, is the new read.
  const [drawn, setDrawn] = useState(value);
  if (value !== drawn) {
    setDrawn(value);
    setCurrent(value);
    setRead(value);
  }
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: string, before: string, previous: string) => {
    setCurrent(next);
    setError(null);
    setConflict(null);
    startTransition(async () => {
      const state = await onSave(next, before);
      if (state.conflict) {
        setConflict(state.conflict);
        return;
      }
      if (state.error) {
        setCurrent(previous);
        setError(state.error);
        return;
      }
      setRead(next);
    });
  };
  const stored = () => {
    const [first] = Object.values(conflict?.current ?? {});
    return first === null || first === undefined ? "" : String(first);
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <SelectInput
          label={label}
          hideLabel
          value={current}
          disabled={disabled || pending}
          onChange={(event) => save(event.target.value, read, current)}
          inputClassName="h-6.5 w-auto px-2 text-xs disabled:text-ink-3"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectInput>
        {pending ? <Spinner /> : null}
      </span>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          labels={Object.fromEntries(
            options.map((option) => [option.value, option.label]),
          )}
          pending={pending}
          onKeepMine={() => save(current, stored(), read)}
          onTakeTheirs={() => {
            const theirs = stored();
            setCurrent(theirs);
            setRead(theirs);
            setConflict(null);
          }}
        />
      ) : null}
    </span>
  );
}
