"use client";

import { Field } from "@base-ui-components/react/field";
import { type ComponentProps, type ReactNode, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";

/**
 * The one skin a text field wears (docs/design/guided-inputs.md §4.3).
 *
 * Ninety-nine class strings drew the product's text fields before this, and
 * only a handful had a focus style. An invalid field takes the bad border
 * from Base UI's `data-invalid`, so the colour follows the field's real state
 * rather than a prop somebody remembered to pass.
 */
export const FIELD_CONTROL_CLASS =
  "h-7.5 w-full rounded-control border border-line-2 bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line data-[invalid]:border-bad-dot";

export interface TextInputProps
  extends Omit<ComponentProps<"input">, "children"> {
  /** The visible label, linked to the control. Never a placeholder's job. */
  readonly label: string;
  /** What the field is for, linked by `aria-describedby`. */
  readonly description?: ReactNode;
  /** Why the server refused this field. Shown and announced while set. */
  readonly error?: string | null;
  /**
   * The format check, returning why a value is wrong or null. Shown when the
   * person leaves the field, never on the first keystroke; held as the
   * control's own validity as they type, so a form submitted from the
   * keyboard is stopped with the same sentence.
   */
  readonly check?: (value: string) => string | null;
  /** A control drawn inside the field's end, such as a reveal toggle. */
  readonly trailing?: ReactNode;
  readonly inputClassName?: string;
}

/**
 * A labelled text field on Base UI `Field` (§4.3): the label, the description
 * and the error are linked to the control in one place, which UIUX-PLAN §7
 * asks of every form.
 *
 * Near its `maxLength`, the field says how much is used, because a limit the
 * person cannot see is a limit they find by losing what they typed.
 */
export function TextInput({
  label,
  description,
  error,
  check,
  trailing,
  className,
  inputClassName,
  name,
  maxLength,
  onChange,
  ...input
}: TextInputProps) {
  const { t } = useTranslations();
  const [length, setLength] = useState(
    () => String(input.value ?? input.defaultValue ?? "").length,
  );
  const nearLimit =
    maxLength !== undefined && length >= Math.ceil(maxLength * 0.8);

  return (
    <Field.Root
      name={name}
      invalid={error ? true : undefined}
      validate={check ? (value) => check(String(value ?? "")) : undefined}
      validationMode="onBlur"
      className={cn("flex flex-col gap-1", className)}
    >
      <Field.Label className="text-sm font-medium text-ink-2">
        {label}
      </Field.Label>
      <div className={trailing ? "relative" : undefined}>
        <Field.Control
          {...input}
          name={name}
          maxLength={maxLength}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setLength(value.length);
            if (check) {
              event.currentTarget.setCustomValidity(check(value) ?? "");
            }
            onChange?.(event);
          }}
          className={cn(
            FIELD_CONTROL_CLASS,
            trailing ? "pr-8" : null,
            inputClassName,
          )}
        />
        {trailing}
      </div>
      {description ? (
        <Field.Description className="text-xs text-ink-3">
          {description}
        </Field.Description>
      ) : null}
      {nearLimit ? (
        <p className="text-xs text-ink-3" aria-live="polite">
          {t("fields.counter", { used: length, max: maxLength ?? 0 })}
        </p>
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
