"use client";

import { useRef, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { DateInput } from "./date-input.tsx";
import { useFormReset } from "./form-reset.ts";

/** Two `YYYY-MM-DD` dates, either of which may be empty. */
export interface DateRange {
  readonly start: string | null;
  readonly end: string | null;
}

export interface DateRangeInputProps {
  /** What the range is, as the group's legend. Absent when the two labels say it. */
  readonly label?: string;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly startName?: string;
  readonly endName?: string;
  readonly startId?: string;
  readonly endId?: string;
  readonly value?: DateRange;
  readonly defaultValue?: DateRange;
  readonly onValueChange?: (value: DateRange) => void;
  /** The earliest date either end takes, `YYYY-MM-DD`. */
  readonly min?: string;
  /** The latest date either end takes, `YYYY-MM-DD`. */
  readonly max?: string;
  readonly today?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
}

const EMPTY: DateRange = { start: null, end: null };

/**
 * A date range (docs/design/guided-inputs.md §4.9): two date fields, where
 * the end's earliest date follows the start, so the picker opens on the right
 * month and a typed end before the start is said under the end at once.
 *
 * A start moved past the end is not undone for the person: the end says why it
 * no longer fits, and they choose which of the two to change. Leave, a
 * holiday and an initiative are each refused by their action for the same.
 */
export function DateRangeInput({
  label,
  startLabel,
  endLabel,
  startName,
  endName,
  startId,
  endId,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  today,
  required,
  disabled,
  className,
  inputClassName,
}: DateRangeInputProps) {
  const { t } = useTranslations();
  const [own, setOwn] = useState<DateRange>(defaultValue ?? EMPTY);
  const current = value ?? own;
  const wrapper = useRef<HTMLSpanElement>(null);
  useFormReset(wrapper, () => setOwn(defaultValue ?? EMPTY));
  const change = (next: DateRange) => {
    if (value === undefined) {
      setOwn(next);
    }
    onValueChange?.(next);
  };

  const endMin =
    current.start && (!min || current.start > min) ? current.start : min;
  const reversed =
    current.start !== null &&
    current.end !== null &&
    current.end < current.start;

  const fields = (
    <span ref={wrapper} className="flex flex-wrap items-start gap-2.5">
      <DateInput
        label={startLabel}
        name={startName}
        id={startId}
        value={current.start}
        min={min}
        max={max}
        today={today}
        required={required}
        disabled={disabled}
        inputClassName={inputClassName}
        onValueChange={(start) => change({ ...current, start })}
      />
      <DateInput
        label={endLabel}
        name={endName}
        id={endId}
        value={current.end}
        min={endMin}
        max={max}
        today={today}
        required={required}
        disabled={disabled}
        inputClassName={inputClassName}
        error={
          reversed
            ? t("fields.dateRange.endBeforeStart", {
                start: current.start ?? "",
              })
            : null
        }
        onValueChange={(end) => change({ ...current, end })}
      />
    </span>
  );

  if (!label) {
    return <div className={cn(className)}>{fields}</div>;
  }
  return (
    <fieldset className={cn("flex flex-col gap-1", className)}>
      <legend className="text-sm font-medium text-ink-2">{label}</legend>
      {fields}
    </fieldset>
  );
}
