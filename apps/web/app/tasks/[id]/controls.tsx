"use client";

import { useState, useTransition } from "react";
import type { WriteState } from "../../cycle/write-state.ts";

/**
 * The task page's small writes (S-28, P5-T11).
 *
 * Each one holds its own pending state and shows the server's refusal beside
 * itself, which is the same shape `InlineSelect` set: a control that reverted
 * silently tells a reader who lacks edit access nothing at all, and the sentence
 * they need is already written in `packages/core`.
 */

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<WriteState>, revert?: () => void) => {
    setError(null);
    startTransition(async () => {
      const state = await fn();
      if (state.error) {
        revert?.();
        setError(state.error);
      }
    });
  };
  return { error, pending, run };
}

export function ChecklistLine({
  title,
  done,
  disabled,
  onToggle,
}: {
  readonly title: string;
  readonly done: boolean;
  readonly disabled: boolean;
  readonly onToggle: (done: boolean) => Promise<WriteState>;
}) {
  const [ticked, setTicked] = useState(done);
  const { error, pending, run } = useRun();

  return (
    <li className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={ticked}
          disabled={disabled || pending}
          onChange={(event) => {
            const next = event.target.checked;
            setTicked(next);
            run(
              () => onToggle(next),
              () => setTicked(!next),
            );
          }}
          className="size-3.5 rounded border-line"
        />
        <span className={ticked ? "text-ink-3 line-through" : undefined}>
          {title}
        </span>
      </label>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </li>
  );
}

export function RailButton({
  label,
  text,
  onRun,
}: {
  readonly label: string;
  readonly text: string;
  readonly onRun: () => Promise<WriteState>;
}) {
  const { error, pending, run } = useRun();
  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        onClick={() => run(onRun)}
        className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-brand disabled:text-ink-4"
      >
        {text}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function DueDateField({
  dueOn,
  disabled,
  onSave,
}: {
  readonly dueOn: string | null;
  readonly disabled: boolean;
  readonly onSave: (dueOn: string) => Promise<WriteState>;
}) {
  const [value, setValue] = useState(dueOn ?? "");
  const { error, pending, run } = useRun();

  return (
    <span className="flex flex-col items-end gap-1">
      <input
        type="date"
        aria-label="Due date"
        value={value}
        disabled={disabled || pending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          run(
            () => onSave(next),
            () => setValue(previous),
          );
        }}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
      />
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
