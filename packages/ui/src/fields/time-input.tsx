"use client";

import { Field } from "@base-ui-components/react/field";
import { normaliseWallClock } from "@openokr/formats";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

/** A saved time as the control shows it: "9:30" is "09:30", and a wrong one is empty. */
const shown = (value: string | null | undefined): string =>
  value ? (normaliseWallClock(value) ?? "") : "";

export interface TimeInputProps {
  readonly label: string;
  /** The label is the field's accessible name only, as beside a "to". */
  readonly hideLabel?: boolean;
  readonly name?: string;
  readonly id?: string;
  /** Controlled, `HH:MM`. Null or empty is no time. */
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onValueChange?: (value: string | null) => void;
  /** Whose clock it is, said with the field: "In Asia/Jakarta." */
  readonly description?: ReactNode;
  /** Why the time cannot be saved as it is. Shown and announced while set. */
  readonly error?: string | null;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
}

/**
 * A time on a clock (docs/design/guided-inputs.md §4.9): the browser's own
 * time control, which draws the reader's 12- or 24-hour clock and always
 * posts `HH:MM`. A saved "9:30", which the server took before it had one
 * rule, is shown as 09:30 rather than as an empty control that a save would
 * then clear.
 */
export function TimeInput({
  label,
  hideLabel,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  description,
  error,
  required,
  disabled,
  className,
  inputClassName,
}: TimeInputProps) {
  const [own, setOwn] = useState(shown(defaultValue));
  const current = value !== undefined ? shown(value) : own;
  const wrapper = useRef<HTMLDivElement>(null);
  useFormReset(wrapper, () => setOwn(shown(defaultValue)));

  return (
    <Field.Root
      ref={wrapper}
      name={name}
      disabled={disabled}
      invalid={error ? true : undefined}
      className={cn("flex flex-col gap-1", className)}
    >
      {hideLabel ? null : (
        <Field.Label className="text-sm font-medium text-ink-2">
          {label}
        </Field.Label>
      )}
      <Field.Control
        id={id}
        type="time"
        name={name}
        value={current}
        required={required}
        aria-label={hideLabel ? label : undefined}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (value === undefined) {
            setOwn(next);
          }
          onValueChange?.(next === "" ? null : next);
        }}
        className={cn(
          FIELD_CONTROL_CLASS,
          "w-auto tabular-nums",
          inputClassName,
        )}
      />
      {description ? (
        <Field.Description className="text-xs text-ink-3">
          {description}
        </Field.Description>
      ) : null}
      {error ? (
        <Field.Error
          match
          role="alert"
          className="text-xs font-medium text-bad"
        >
          {error}
        </Field.Error>
      ) : null}
    </Field.Root>
  );
}

/** Two `HH:MM` times, either of which may be empty. */
export interface TimeRange {
  readonly start: string | null;
  readonly end: string | null;
}

export interface TimeRangeInputProps {
  /** What the window is, as the group's legend. */
  readonly label: string;
  /** Each time's accessible name; the two sit either side of "to". */
  readonly startLabel: string;
  readonly endLabel: string;
  readonly startName?: string;
  readonly endName?: string;
  readonly value?: TimeRange | null;
  readonly defaultValue?: TimeRange | null;
  readonly onValueChange?: (value: TimeRange) => void;
  readonly description?: ReactNode;
  /** Why the server refused the window. */
  readonly error?: string | null;
  readonly disabled?: boolean;
  readonly className?: string;
}

const NO_TIMES: TimeRange = { start: null, end: null };

/**
 * A window of the day (§4.9), for quiet hours: both times or neither, and it
 * opens on the saved window. An end earlier than the start is a window that
 * runs overnight, 22:00 to 07:00, which is the usual one, so it is never
 * refused. One time alone makes the other required, so the browser holds
 * the save rather than the server refusing it, and it is said under the
 * empty one once the person leaves the pair, never while they are still on
 * their way to the second. The server refuses it too, rather than guessing
 * that "off" was meant.
 */
export function TimeRangeInput({
  label,
  startLabel,
  endLabel,
  startName,
  endName,
  value,
  defaultValue,
  onValueChange,
  description,
  error,
  disabled,
  className,
}: TimeRangeInputProps) {
  const { t } = useTranslations();
  const [own, setOwn] = useState<TimeRange>(defaultValue ?? NO_TIMES);
  const current = value === undefined ? own : (value ?? NO_TIMES);
  const [left, setLeft] = useState(false);
  const wrapper = useRef<HTMLFieldSetElement>(null);
  useFormReset(wrapper, () => {
    setOwn(defaultValue ?? NO_TIMES);
    setLeft(false);
  });
  const change = (next: TimeRange) => {
    if (value === undefined) {
      setOwn(next);
    }
    onValueChange?.(next);
  };

  const start = shown(current.start);
  const end = shown(current.end);
  const half = left ? t("fields.timeRange.bothOrNeither") : null;

  return (
    <fieldset
      ref={wrapper}
      className={cn("flex flex-col gap-1", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setLeft(true);
        }
      }}
    >
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      {description ? <p className="text-xs text-ink-3">{description}</p> : null}
      <div className="flex flex-wrap items-start gap-2">
        <TimeInput
          label={startLabel}
          hideLabel
          name={startName}
          value={start}
          disabled={disabled}
          required={start === "" && end !== ""}
          error={start === "" && end !== "" ? half : null}
          onValueChange={(next) => change({ ...current, start: next })}
        />
        <span className="pt-1.5 text-xs text-ink-3">{t("common.to")}</span>
        <TimeInput
          label={endLabel}
          hideLabel
          name={endName}
          value={end}
          disabled={disabled}
          required={end === "" && start !== ""}
          error={end === "" && start !== "" ? half : null}
          onValueChange={(next) => change({ ...current, end: next })}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
