"use client";

import { Field } from "@base-ui-components/react/field";
import { isHexColour } from "@openokr/formats";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRefusedField } from "../forms/refused-fields.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

/**
 * A colour, picked or typed (docs/design/guided-inputs.md §4.11).
 *
 * The native picker sits beside the hex box and the two stay one value: a
 * colour picked fills the box, and six digits typed move the picker. Only the
 * box is named, so the form posts what it shows, and empty stays a valid
 * answer where the caller allows one.
 *
 * **The caller's rule speaks as the colour is chosen**, not after Save: a
 * complete colour is judged at once, because picking one is a decision rather
 * than a keystroke on the way to one. A half-typed hex is only marked when
 * the person leaves the box. Either holds the save as the box's own validity.
 */
export function ColourInput({
  label,
  name,
  id,
  defaultValue,
  description,
  error: givenError,
  check,
  trailing,
  placeholder = "#336699",
  fallback,
  onValueChange,
  className,
}: {
  readonly label: string;
  readonly name: string;
  readonly id?: string;
  readonly defaultValue?: string;
  readonly description?: ReactNode;
  /** Why the server refused it. Shown while nothing nearer is wrong. */
  readonly error?: string | null;
  /** The caller's rule for a whole colour, lower-cased: why not, or null. */
  readonly check?: (hex: string) => string | null;
  /** Drawn after the box, such as a swatch of the colour in force. */
  readonly trailing?: ReactNode;
  readonly placeholder?: string;
  /**
   * The colour the picker shows while the box is empty: the colour in force,
   * so an empty field never draws black (docs/design/branding-page.md §3).
   */
  readonly fallback?: string;
  /**
   * Each whole colour the caller's rule accepts, lower-cased, and null for
   * anything else: half typed, empty or refused. For a live preview.
   */
  readonly onValueChange?: (hex: string | null) => void;
  readonly className?: string;
}) {
  // Without a message passed in, the nearest `RefusedFields` says what the
  // server refused about this field (guided-inputs §4.2, plan U1b).
  const refused = useRefusedField(name);
  const error = givenError ?? refused ?? null;
  const { t } = useTranslations();
  const [value, setValue] = useState(defaultValue ?? "");
  const [left, setLeft] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useFormReset(box, () => {
    setValue(defaultValue ?? "");
    setLeft(false);
  });

  const typed = value.trim();
  const whole = isHexColour(typed);
  const shape = typed !== "" && !whole ? t("fields.colour.sixHexDigits") : null;
  const ruled = whole ? (check?.(typed.toLowerCase()) ?? null) : null;
  const shown = ruled ?? (left ? shape : null) ?? error ?? null;

  useEffect(() => {
    box.current?.setCustomValidity(ruled ?? shape ?? "");
  }, [ruled, shape]);

  const accepted = whole && ruled === null ? typed.toLowerCase() : null;
  useEffect(() => {
    onValueChange?.(accepted);
  }, [accepted, onValueChange]);

  return (
    <Field.Root
      name={name}
      invalid={shown ? true : undefined}
      className={cn("flex flex-col gap-1", className)}
    >
      <Field.Label className="text-sm font-medium text-ink-2">
        {label}
      </Field.Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={t("fields.colour.pick", { label })}
          value={whole ? typed.toLowerCase() : (fallback ?? "#000000")}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setLeft(true);
          }}
          className="h-7.5 w-9 flex-none cursor-pointer rounded-control border border-line-2 bg-surface p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
        />
        <Field.Control
          ref={box}
          id={id}
          name={name}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onBlur={() => {
            setValue(typed);
            setLeft(true);
          }}
          placeholder={placeholder}
          maxLength={7}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          className={cn(FIELD_CONTROL_CLASS, "flex-1 font-mono")}
        />
        {trailing}
      </div>
      {description ? (
        <Field.Description className="text-xs text-ink-3">
          {description}
        </Field.Description>
      ) : null}
      {shown ? (
        <Field.Error
          match
          role="alert"
          className="text-xs font-medium text-bad"
        >
          {shown}
        </Field.Error>
      ) : null}
    </Field.Root>
  );
}
