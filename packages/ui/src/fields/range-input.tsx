"use client";

import { type ComponentProps, useId } from "react";
import { cn } from "../lib/cn.ts";

export interface RangeInputProps
  extends Omit<ComponentProps<"input">, "type" | "children"> {
  /** The visible label, linked to the slider. */
  readonly label: string;
  /** Named without being drawn, where the row already says what it is. */
  readonly hideLabel?: boolean;
}

/**
 * A value chosen along a scale: a score from 0 to 1 (docs/design/
 * guided-inputs.md §6, 10b).
 *
 * The browser's own slider, which the keyboard and a screen reader already
 * understand, with its label linked and the brand's colour, so the raw-field
 * gate can hold every field to the kit as it holds a dropdown.
 */
export function RangeInput({
  label,
  hideLabel,
  className,
  id,
  ...input
}: RangeInputProps) {
  const generated = useId();
  const rangeId = id ?? generated;
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      {hideLabel ? null : (
        <label htmlFor={rangeId} className="text-xs font-medium text-ink-3">
          {label}
        </label>
      )}
      <input
        {...input}
        id={rangeId}
        type="range"
        aria-label={hideLabel ? label : input["aria-label"]}
        className="min-w-0 flex-1 accent-brand disabled:opacity-60"
      />
    </span>
  );
}
