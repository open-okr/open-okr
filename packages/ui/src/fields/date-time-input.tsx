"use client";

import { Field } from "@base-ui-components/react/field";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

export interface DateTimeInputProps {
  readonly label: string;
  readonly name?: string;
  readonly id?: string;
  /** Controlled, `YYYY-MM-DDTHH:MM`, with no offset. */
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onValueChange?: (value: string | null) => void;
  readonly min?: string;
  readonly max?: string;
  /**
   * The zone the time is read in, named beside the field. The workspace's,
   * for a workspace screen. Absent means the reader's own browser zone, read
   * once the page is on their device.
   */
  readonly timeZone?: string;
  /**
   * The form field the zone is posted as, so the server can turn the local
   * time into an instant. Only where the zone is the browser's: a workspace
   * screen's server knows the workspace's zone itself.
   */
  readonly zoneName?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * A date and a time (docs/design/guided-inputs.md §4.9): the browser's own
 * `datetime-local` control, which has no zone of its own, with the zone it
 * is read in said beside it. "09:00" means nothing until somebody says
 * where, and a server that guessed read it in its own zone, which is UTC in a
 * container and is nobody's.
 */
export function DateTimeInput({
  label,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  timeZone,
  zoneName,
  required,
  disabled,
  className,
}: DateTimeInputProps) {
  const { t } = useTranslations();
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value !== undefined ? (value ?? "") : own;
  const wrapper = useRef<HTMLDivElement>(null);
  useFormReset(wrapper, () => setOwn(defaultValue ?? ""));

  // Read after mounting: the server rendering this has no browser to ask.
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => {
    if (timeZone === undefined) {
      setDevice(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [timeZone]);
  const zone = timeZone ?? device;

  return (
    <Field.Root
      ref={wrapper}
      name={name}
      disabled={disabled}
      className={cn("flex flex-col gap-1", className)}
    >
      <Field.Label className="text-sm font-medium text-ink-2">
        {label}
      </Field.Label>
      <Field.Control
        id={id}
        type="datetime-local"
        name={name}
        value={current}
        min={min}
        max={max}
        required={required}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (value === undefined) {
            setOwn(next);
          }
          onValueChange?.(next === "" ? null : next);
        }}
        className={cn(FIELD_CONTROL_CLASS, "w-auto tabular-nums")}
      />
      {zone ? (
        <Field.Description className="text-xs text-ink-3">
          {t("fields.dateTime.inZone", { zone })}
        </Field.Description>
      ) : null}
      {zoneName ? (
        <input type="hidden" name={zoneName} value={zone ?? ""} />
      ) : null}
    </Field.Root>
  );
}
