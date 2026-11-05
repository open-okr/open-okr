"use client";

import { DateInput, guardPress, Spinner, useTranslations } from "@openokr/ui";
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
  // Which control started the write in flight, so only that one shows a spinner.
  const [acting, setActing] = useState<string | null>(null);
  const run = (
    name: string,
    fn: () => Promise<WriteState>,
    revert?: () => void,
  ) => {
    setError(null);
    setActing(name);
    startTransition(async () => {
      const state = await fn();
      if (state.error) {
        revert?.();
        setError(state.error);
      }
    });
  };
  return { error, pending, acting, run };
}

export function ChecklistLine({
  title,
  done,
  disabled,
  onToggle,
  onRemove,
}: {
  readonly title: string;
  readonly done: boolean;
  readonly disabled: boolean;
  readonly onToggle: (done: boolean) => Promise<WriteState>;
  /**
   * Taking the line off (P6-G27). Absent where the reader cannot edit, and
   * distinct from ticking it: a ticked line says the work was done, and a
   * removed one says it was never work.
   */
  readonly onRemove?: () => Promise<WriteState>;
}) {
  const { t } = useTranslations();
  const [ticked, setTicked] = useState(done);
  const { error, pending, acting, run } = useRun();

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
              "toggle",
              () => onToggle(next),
              () => setTicked(!next),
            );
          }}
          className="size-3.5 rounded border-line"
        />
        <span className={ticked ? "text-ink-3 line-through" : undefined}>
          {title}
        </span>
        {pending && acting === "toggle" ? <Spinner /> : null}
        {onRemove && !disabled ? (
          // Refused with `aria-disabled`, not `disabled`, so the button keeps
          // keyboard focus while the write is sent; see `guardPress`.
          <button
            type="button"
            aria-disabled={pending || undefined}
            aria-busy={(pending && acting === "remove") || undefined}
            aria-label={`${t("common.remove")} "${title}"`}
            onClick={guardPress(pending, () => run("remove", onRemove))}
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-4 hover:text-bad"
          >
            {pending && acting === "remove" ? <Spinner /> : null}
            <span>{t("common.remove")}</span>
          </button>
        ) : null}
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
      {/* Refused with `aria-disabled`, not `disabled`, so the button keeps
       * keyboard focus while the write is sent; see `guardPress`. */}
      <button
        type="button"
        aria-label={label}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onClick={guardPress(pending, () => run("run", onRun))}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-brand disabled:text-ink-4 aria-disabled:text-ink-4"
      >
        {pending ? <Spinner /> : null}
        <span>{text}</span>
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
  const { t } = useTranslations();

  const [value, setValue] = useState(dueOn ?? "");
  const { error, pending, run } = useRun();

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1.5">
        {pending ? <Spinner /> : null}
        <DateInput
          label={t("tasks.detail.controls.dueDate")}
          hideLabel
          value={value}
          disabled={disabled || pending}
          onValueChange={(chosen) => {
            const next = chosen ?? "";
            const previous = value;
            setValue(next);
            run(
              "due",
              () => onSave(next),
              () => setValue(previous),
            );
          }}
          inputClassName="h-auto py-1"
        />
      </span>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
