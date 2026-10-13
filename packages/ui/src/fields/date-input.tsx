"use client";

import { Field } from "@base-ui-components/react/field";
import type { FocusEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { useRef, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { browserToday, relativeDate } from "./date-format.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

export interface DateInputProps {
  readonly label: string;
  /** The label is the field's accessible name only, as in a table cell. */
  readonly hideLabel?: boolean;
  readonly name?: string;
  readonly id?: string;
  /** Controlled, `YYYY-MM-DD`. Null or empty is no date. */
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onValueChange?: (value: string | null) => void;
  /** The earliest date it takes, `YYYY-MM-DD`. */
  readonly min?: string;
  /** The latest date it takes, `YYYY-MM-DD`. */
  readonly max?: string;
  /**
   * Today in the workspace's calendar, from the server, for the label beside
   * the date. The browser's own today when nobody says.
   */
  readonly today?: string;
  readonly description?: ReactNode;
  /** Something worth saying about the date that does not refuse it. */
  readonly warning?: ReactNode;
  /** Why the date cannot be saved as it is. Shown and announced while set. */
  readonly error?: string | null;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * A date (docs/design/guided-inputs.md §4.9): the browser's own date control,
 * which every platform draws a picker for and every screen reader knows, with
 * `min` and `max` from the rule it answers to, and the date in words beside
 * it ("in 12 days"), linked as its description so it is read with it.
 *
 * A `warning` is said and refuses nothing: a key result due after its cycle
 * ends is worth knowing and is not wrong (METHOD.md has no such rule).
 */
export function DateInput({
  label,
  hideLabel,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  today,
  description,
  warning,
  error,
  required,
  disabled,
  className,
  inputClassName,
  inputRef,
  onBlur,
  onKeyDown,
}: DateInputProps) {
  const { locale } = useTranslations();
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value !== undefined ? (value ?? "") : own;
  const wrapper = useRef<HTMLSpanElement>(null);
  useFormReset(wrapper, () => setOwn(defaultValue ?? ""));
  const words =
    current === ""
      ? null
      : relativeDate(
          current,
          today ?? browserToday(),
          locale === "pseudo" ? "en" : locale,
        );

  return (
    <Field.Root
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
      <span ref={wrapper} className="flex flex-wrap items-center gap-1.5">
        <Field.Control
          ref={inputRef}
          id={id}
          type="date"
          name={name}
          value={current}
          min={min}
          max={max}
          required={required}
          aria-label={hideLabel ? label : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (value === undefined) {
              setOwn(next);
            }
            onValueChange?.(next === "" ? null : next);
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={cn(
            FIELD_CONTROL_CLASS,
            "w-auto tabular-nums",
            inputClassName,
          )}
        />
        {words ? (
          <Field.Description className="text-xs text-ink-3">
            {words}
          </Field.Description>
        ) : null}
      </span>
      {description ? (
        <Field.Description className="text-xs text-ink-3">
          {description}
        </Field.Description>
      ) : null}
      {warning ? (
        <Field.Description className="text-xs font-medium text-warn">
          {warning}
        </Field.Description>
      ) : null}
      <Field.Error role="alert" className="text-xs font-medium text-bad" />
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
