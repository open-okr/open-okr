"use client";

import {
  type ComponentProps,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";

/**
 * The skin a plain prose box wears: the text field's, taller, and growing
 * with what is written where the browser can (`field-sizing: content`). A
 * browser that cannot keeps the rows it was given.
 */
export const TEXT_AREA_CLASS =
  "min-h-15 w-full rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm text-ink outline-none [field-sizing:content] placeholder:text-ink-4 focus:border-brand focus:ring-2 focus:ring-brand-line aria-[invalid=true]:border-bad-dot";

export interface TextAreaProps
  extends Omit<ComponentProps<"textarea">, "children"> {
  /** The visible label, linked to the box. Never a placeholder's job. */
  readonly label: string;
  /** Named without being drawn, where the row already says what it is. */
  readonly hideLabel?: boolean;
  /** What the box is for, linked by `aria-describedby`. */
  readonly description?: ReactNode;
  /** Why the server refused it. Shown and announced while set. */
  readonly error?: string | null;
  readonly inputClassName?: string;
}

/**
 * Plain prose that is not rich text: a reason, a note, a statement
 * (docs/design/guided-inputs.md §4.3).
 *
 * These were one-line boxes that took up to 2000 characters, so a reason
 * somebody had to give in full scrolled sideways out of sight. The box grows
 * with the text instead, and near its `maxLength`, which is always the
 * server's, it says how much is used.
 */
export function TextArea({
  label,
  hideLabel,
  description,
  error,
  className,
  inputClassName,
  id,
  rows = 3,
  maxLength,
  onChange,
  "aria-describedby": describedBy,
  ...area
}: TextAreaProps) {
  const { t } = useTranslations();
  const generated = useId();
  const areaId = id ?? generated;
  const box = useRef<HTMLTextAreaElement>(null);
  const startLength = () =>
    String(area.value ?? area.defaultValue ?? "").length;
  const [length, setLength] = useState(startLength);
  useFormReset(box, () => setLength(startLength()));
  const nearLimit =
    maxLength !== undefined && length >= Math.ceil(maxLength * 0.8);

  const ids = {
    description: `${areaId}-description`,
    counter: `${areaId}-counter`,
    error: `${areaId}-error`,
  };
  const described =
    [
      describedBy,
      description ? ids.description : null,
      nearLimit ? ids.counter : null,
      error ? ids.error : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {hideLabel ? null : (
        <label htmlFor={areaId} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <textarea
        {...area}
        ref={box}
        id={areaId}
        aria-label={hideLabel ? label : area["aria-label"]}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        onChange={(event) => {
          setLength(event.currentTarget.value.length);
          onChange?.(event);
        }}
        className={cn(TEXT_AREA_CLASS, inputClassName)}
      />
      {description ? (
        <p id={ids.description} className="text-xs text-ink-3">
          {description}
        </p>
      ) : null}
      {nearLimit ? (
        <p id={ids.counter} className="text-xs text-ink-3" aria-live="polite">
          {t("fields.counter", { used: length, max: maxLength ?? 0 })}
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
