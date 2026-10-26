"use client";

import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "../lib/cn.ts";

/** The text field's skin, for the browser's own dropdown. */
export const SELECT_CLASS =
  "h-7.5 w-full rounded-control border border-line-2 bg-surface px-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line aria-[invalid=true]:border-bad-dot disabled:opacity-60";

export interface SelectInputProps extends ComponentProps<"select"> {
  /** The visible label, linked to the dropdown. */
  readonly label: string;
  /** Named without being drawn, where the row already says what it is. */
  readonly hideLabel?: boolean;
  /** What the choice does, linked by `aria-describedby`. */
  readonly description?: ReactNode;
  /** Why the server refused it. Shown and announced while set. */
  readonly error?: string | null;
  readonly inputClassName?: string;
}

/**
 * A choice from a short fixed list: a status, a level, a kind, a weekday
 * (docs/design/guided-inputs.md §4.10, decided 13 October 2026).
 *
 * **Still the browser's own dropdown**, on purpose. A list that never grows
 * past a handful has nothing to search, and the native control works without
 * JavaScript and opens the phone's own picker. What it gains is what every
 * other field has: a label linked to it, a description and a refusal linked
 * by `aria-describedby`, and the kit's skin, where each screen drew its own.
 * A list of records to choose among, people or goals, is `EntityPicker`.
 */
export function SelectInput({
  label,
  hideLabel,
  description,
  error,
  className,
  inputClassName,
  id,
  children,
  "aria-describedby": describedBy,
  ...select
}: SelectInputProps) {
  const generated = useId();
  const selectId = id ?? generated;
  const ids = {
    description: `${selectId}-description`,
    error: `${selectId}-error`,
  };
  const described =
    [
      describedBy,
      description ? ids.description : null,
      error ? ids.error : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* Hidden, it names the control as every field in the kit does: on
          the control itself. */}
      {hideLabel ? null : (
        <label htmlFor={selectId} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <select
        {...select}
        id={selectId}
        aria-label={hideLabel ? label : select["aria-label"]}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={cn(SELECT_CLASS, inputClassName)}
      >
        {children}
      </select>
      {description ? (
        <p id={ids.description} className="text-xs text-ink-3">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={ids.error} role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
