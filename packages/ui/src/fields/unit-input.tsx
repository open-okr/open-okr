"use client";

import { Autocomplete } from "@base-ui-components/react/autocomplete";
import {
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

export interface UnitInputProps {
  readonly label: string;
  /** The label is the field's accessible name only, as in a table cell. */
  readonly hideLabel?: boolean;
  readonly name?: string;
  readonly id?: string;
  /** Controlled. */
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  /** The units this workspace already uses, offered first. */
  readonly known?: readonly string[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** The longest unit a key result or a KPI stores. */
const UNIT_MAX_LENGTH = 60;

/**
 * A measure's unit (docs/design/guided-inputs.md §4.8), on Base UI
 * `Autocomplete`: the units this workspace already uses, then a short list
 * of common ones, matched as the person types. Free text is still a unit,
 * because a measure in "NPS points" or "rupiah" is the team's to name; the
 * list only saves typing the same word twice and spelling it two ways.
 */
export function UnitInput({
  label,
  hideLabel,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  known = [],
  placeholder,
  disabled,
  className,
  inputClassName,
  inputRef,
  onBlur,
  onKeyDown,
}: UnitInputProps) {
  const { t } = useTranslations();
  const generated = useId();
  const inputId = id ?? `${generated}-unit`;
  const common = [
    "%",
    "US$",
    t("fields.unit.people"),
    t("fields.unit.days"),
    t("fields.unit.hours"),
    t("fields.unit.points"),
  ];
  const commonKey = common.join("\n");
  const wrapper = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  useFormReset(wrapper, () => setGeneration((one) => one + 1));
  // The workspace's own first, then the common ones, each once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `common` is rebuilt each render; its joined key is what changes
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const unit of [...known, ...common]) {
      const trimmed = unit.trim();
      const key = trimmed.toLocaleLowerCase();
      if (trimmed !== "" && !seen.has(key)) {
        seen.add(key);
        out.push(trimmed);
      }
    }
    return out;
  }, [known, commonKey]);

  return (
    <div ref={wrapper} className={cn("flex flex-col gap-1", className)}>
      {hideLabel ? null : (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <Autocomplete.Root
        key={generation}
        items={items}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        onValueChange={(next) => onValueChange?.(next)}
        disabled={disabled}
      >
        <Autocomplete.Input
          ref={inputRef}
          id={inputId}
          // A cell names its control directly, as a table cell does.
          aria-label={hideLabel ? label : undefined}
          name={name}
          maxLength={UNIT_MAX_LENGTH}
          placeholder={placeholder}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={cn(FIELD_CONTROL_CLASS, inputClassName)}
        />
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4} className="z-50">
            <Autocomplete.Popup className="max-h-60 min-w-32 w-[var(--anchor-width)] overflow-y-auto rounded-control border border-line-2 bg-surface py-1 shadow-lg empty:hidden">
              <Autocomplete.List>
                {(unit: string) => (
                  <Autocomplete.Item
                    key={unit}
                    value={unit}
                    className="cursor-default px-2.5 py-1.5 text-sm text-ink data-[highlighted]:bg-raised"
                  >
                    {unit}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  );
}
