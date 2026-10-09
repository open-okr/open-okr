"use client";

import { Field } from "@base-ui-components/react/field";
import { NumberField } from "@base-ui-components/react/number-field";
import type { FocusEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { formatMeasure } from "../lib/format-measure.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

export interface NumberInputProps {
  readonly label: string;
  /** The label is the field's accessible name only, as in a table cell. */
  readonly hideLabel?: boolean;
  /** The form field the raw number is posted as. */
  readonly name?: string;
  readonly id?: string;
  /** Controlled. Null is an empty field. */
  readonly value?: number | null;
  readonly defaultValue?: number | null;
  readonly onValueChange?: (value: number | null) => void;
  readonly min?: number;
  readonly max?: number;
  /** What the arrow keys and the stepper add. 1 by default. */
  readonly step?: number;
  /** Shown beside the number, and read with its label. */
  readonly unit?: string | null;
  readonly description?: ReactNode;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * A number (docs/design/guided-inputs.md §4.8), on Base UI `NumberField`
 * inside `Field`, so its label, description and error are linked the way
 * every field in the kit is.
 *
 * It shows the number grouped in the reader's language and posts the raw
 * number through its own hidden input, so a server action reads `1234.5`
 * where the reader saw `1,234.5`. **An empty field posts nothing, never 0.**
 * The arrow keys step it, `min` and `max` hold it on leaving the field, and
 * reaching it selects the number, so typing replaces it.
 * The unit is drawn beside the number and read as part of the label.
 */
export function NumberInput({
  label,
  hideLabel,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step,
  unit,
  description,
  required,
  disabled,
  placeholder,
  className,
  inputClassName,
  inputRef,
  onBlur,
  onKeyDown,
}: NumberInputProps) {
  const { t, locale } = useTranslations();
  const suffix = unit?.trim() || null;

  return (
    <Field.Root
      name={name}
      disabled={disabled}
      className={cn("flex flex-col gap-1", className)}
    >
      {hideLabel ? null : (
        <Field.Label className="text-sm font-medium text-ink-2">
          {label}
          {suffix ? <span className="sr-only"> ({suffix})</span> : null}
        </Field.Label>
      )}
      <NumberField.Root
        id={id}
        name={name}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined && defaultValue !== null
          ? { defaultValue }
          : {})}
        onValueChange={(next) => onValueChange?.(next)}
        min={min}
        max={max}
        step={step}
        required={required}
        disabled={disabled}
        locale={locale === "pseudo" ? "en" : locale}
        inputRef={inputRef}
      >
        <NumberField.Group className="flex items-center gap-1.5">
          <NumberField.Input
            placeholder={placeholder}
            // Base UI says "Number field" in English; this says it in the
            // reader's language.
            aria-roledescription={t("fields.number.role")}
            // A cell names its control directly, as every cell in a table
            // does, rather than through a label nobody sees.
            aria-label={
              hideLabel ? (suffix ? `${label} (${suffix})` : label) : undefined
            }
            onFocus={(event) => {
              // Base UI puts the caret at the end on first focus, which
              // undoes the selection a browser makes when a field is tabbed
              // to: typing 150 into 120 then made 120150. Selecting the
              // number after its handler has run makes typing replace it.
              const input = event.currentTarget;
              queueMicrotask(() => {
                if (document.activeElement === input) {
                  input.select();
                }
              });
            }}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className={cn(FIELD_CONTROL_CLASS, "tabular-nums", inputClassName)}
          />
          {suffix ? (
            <span aria-hidden="true" className="shrink-0 text-xs text-ink-3">
              {suffix}
            </span>
          ) : null}
        </NumberField.Group>
      </NumberField.Root>
      {description ? (
        <Field.Description className="text-xs text-ink-3">
          {description}
        </Field.Description>
      ) : null}
      <Field.Error role="alert" className="text-xs font-medium text-bad" />
    </Field.Root>
  );
}

export interface MetricInputProps extends NumberInputProps {
  /** Where the measure started, or null where nobody recorded it. */
  readonly baseline?: number | null;
  /** Where it is going, or null where nobody has set it yet. */
  readonly target?: number | null;
}

/**
 * A key result's or a KPI's value (§4.8): a `NumberInput` that shows the
 * measure's unit and, as its hint, where the measure starts and where it is
 * going, "from 40 to 75 %", so the person typing a value can see whether it
 * is the number they meant.
 */
export function MetricInput({
  baseline,
  target,
  unit,
  description,
  ...input
}: MetricInputProps) {
  const { t } = useTranslations();
  const range =
    baseline !== undefined &&
    baseline !== null &&
    target !== undefined &&
    target !== null
      ? t("fields.metric.range", {
          from: formatMeasure(baseline),
          to: formatMeasure(target, unit),
        })
      : null;
  return (
    <NumberInput
      {...input}
      unit={unit}
      step={input.step ?? 1}
      description={description ?? range ?? undefined}
    />
  );
}
