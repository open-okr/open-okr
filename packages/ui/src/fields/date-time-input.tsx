"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { DateInput } from "./date-input.tsx";
import { useFormReset } from "./form-reset.ts";
import { TimeInput } from "./time-input.tsx";

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

interface DateTimeParts {
  readonly date: string;
  readonly time: string;
}

const split = (value: string | null | undefined): DateTimeParts => {
  const [date = "", time = ""] = (value ?? "").split("T");
  return { date, time };
};
const combine = ({ date, time }: DateTimeParts): string =>
  date && time ? `${date}T${time}` : "";

/**
 * The shared date picker plus a time field. The form still posts one local
 * datetime, without an offset; the zone beside the pair says how to read it.
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
  const zoneId = useId();
  const [own, setOwn] = useState(() => split(defaultValue));
  // A controlled empty value cannot carry a half-completed date/time. Keep
  // that draft until both parts are available, while complete values remain
  // controlled by the caller. External nonempty values take precedence.
  const [partial, setPartial] = useState<DateTimeParts | null>(null);
  useEffect(() => {
    if (value) {
      setPartial(null);
    }
  }, [value]);
  const current =
    value === undefined ? own : value ? split(value) : (partial ?? split(""));
  const combined = combine(current);
  const wrapper = useRef<HTMLFieldSetElement>(null);
  useFormReset(wrapper, () => {
    setOwn(split(defaultValue));
    setPartial(null);
  });
  const change = (next: DateTimeParts) => {
    const nextValue = combine(next);
    if (value === undefined) {
      setOwn(next);
    }
    setPartial(nextValue === "" ? next : null);
    onValueChange?.(nextValue === "" ? null : nextValue);
  };

  // Read after mounting: the server rendering this has no browser to ask.
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => {
    if (timeZone === undefined) {
      setDevice(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [timeZone]);
  const zone = timeZone ?? device;
  const lower = split(min);
  const upper = split(max);

  return (
    <fieldset
      ref={wrapper}
      disabled={disabled}
      aria-describedby={zone ? zoneId : undefined}
      className={cn("flex min-w-0 flex-col gap-1", className)}
    >
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      <div className="flex flex-wrap items-start gap-2.5">
        <DateInput
          id={id}
          label={t("fields.dateTime.date", { label })}
          hideLabel
          value={current.date}
          min={lower.date || undefined}
          max={upper.date || undefined}
          required={required || current.time !== ""}
          disabled={disabled}
          onValueChange={(date) => change({ ...current, date: date ?? "" })}
        />
        <TimeInput
          id={id ? `${id}-time` : undefined}
          label={t("fields.dateTime.time", { label })}
          hideLabel
          value={current.time}
          min={
            current.date === lower.date ? lower.time || undefined : undefined
          }
          max={
            current.date === upper.date ? upper.time || undefined : undefined
          }
          required={required || current.date !== ""}
          disabled={disabled}
          onValueChange={(time) => change({ ...current, time: time ?? "" })}
        />
      </div>
      <input type="hidden" name={name} value={combined} disabled={disabled} />
      {zone ? (
        <p id={zoneId} className="text-xs text-ink-3">
          {t("fields.dateTime.inZone", { zone })}
        </p>
      ) : null}
      {zoneName ? (
        <input
          type="hidden"
          name={zoneName}
          value={zone ?? ""}
          disabled={disabled}
        />
      ) : null}
    </fieldset>
  );
}
