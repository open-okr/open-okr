"use client";

import { Combobox } from "@base-ui-components/react/combobox";
import { ChevronDown } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

interface ZoneOption {
  readonly zone: string;
  readonly label: string;
  /** What a search matches against, lower-cased. */
  readonly search: string;
}

interface ZoneGroup {
  readonly value: string;
  readonly items: ZoneOption[];
}

export interface TimezoneSelectProps {
  readonly label: string;
  readonly description?: ReactNode;
  readonly error?: string | null;
  /** The form field the chosen zone's name is submitted as. */
  readonly name?: string;
  /** The server's own list (`listTimezones()` in `packages/formats`). */
  readonly zones: readonly string[];
  /** Controlled: the chosen zone's name, or null for none. */
  readonly value?: string | null;
  /** Uncontrolled: the zone the field opens on. */
  readonly defaultValue?: string | null;
  readonly onValueChange?: (zone: string | null) => void;
  readonly required?: boolean;
}

function offsetOf(zone: string, locale: string, now: Date): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

function genericNameOf(zone: string, locale: string, now: Date): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        timeZoneName: "longGeneric",
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/**
 * The ways somebody writes an offset: `GMT+8`, `UTC+8`, `+8`, `+08`,
 * `+08:00`. A zone at whole hours also answers to the short forms.
 */
function offsetSpellings(offset: string): string[] {
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(offset);
  if (!match) {
    return [];
  }
  const sign = match[1] ?? "+";
  const hours = match[2] ?? "0";
  const minutes = match[3];
  const padded = hours.padStart(2, "0");
  const short = minutes ? `${hours}:${minutes}` : hours;
  return [
    `gmt${sign}${short}`,
    `utc${sign}${short}`,
    `${sign}${short}`,
    `${sign}${padded}`,
    `${sign}${padded}:${minutes ?? "00"}`,
    `${sign}${padded}${minutes ?? "00"}`,
    ...(match[1] ? [] : ["gmt", "utc"]),
  ];
}

function describeZone(zone: string, locale: string, now: Date): ZoneOption {
  const city = zone.includes("/")
    ? (zone.split("/").pop() ?? zone).replaceAll("_", " ")
    : zone;
  const offset = offsetOf(zone, locale, now);
  const label = zone.includes("/")
    ? `${city}, ${offset}, ${zone}`
    : `${zone}, ${offset}`;
  const search = [
    city,
    zone,
    zone.replaceAll("_", " "),
    genericNameOf(zone, locale, now),
    ...offsetSpellings(offset),
  ]
    .join("|")
    .toLowerCase();
  return { zone, label, search };
}

/** Lower-cased, spaces collapsed, and an underscore read as a space. */
function normaliseQuery(query: string): string {
  return query.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}

/**
 * This device's zone, spelled the way the server's list spells it, or null
 * when the list does not hold it. A browser may say `Asia/Kolkata` where the
 * server lists `Asia/Calcutta`; both resolve to one zone here.
 */
export function matchDeviceTimezone(
  device: string,
  zones: readonly string[],
): string | null {
  if (zones.includes(device)) {
    return device;
  }
  const resolve = (zone: string): string | null => {
    try {
      return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
        .timeZone;
    } catch {
      return null;
    }
  };
  const target = resolve(device);
  if (target === null) {
    return null;
  }
  return zones.find((zone) => resolve(zone) === target) ?? null;
}

/**
 * A timezone chosen from the server's own list (docs/design/guided-inputs.md
 * §4.6), so nothing typed can be a zone the server refuses.
 *
 * Each zone shows its city, its offset today and its name, grouped by region,
 * and a search matches any of those, an offset written as `+8` or `UTC+8`,
 * or the zone's everyday name in the reader's language ("Malaysia Time").
 * This device's zone is offered in one press. A stored name that is not on
 * the list still shows, marked, so opening and saving a form never rewrites
 * it behind somebody's back.
 */
export function TimezoneSelect({
  label,
  description,
  error,
  name,
  zones,
  value,
  defaultValue,
  onValueChange,
  required,
}: TimezoneSelectProps) {
  const { t, locale: catalogue } = useTranslations();
  // The pseudo-locale is a catalogue check, not a language Intl can name a
  // zone in.
  const locale = catalogue === "pseudo" ? "en" : catalogue;
  const [own, setOwn] = useState<string | null>(defaultValue ?? null);
  const chosen = value !== undefined ? value : own;
  const wrapper = useRef<HTMLDivElement>(null);
  useFormReset(wrapper, () => setOwn(defaultValue ?? null));
  const [device, setDevice] = useState<string | null>(null);

  // Read after mounting: the server rendering this has no device to ask.
  useEffect(() => {
    setDevice(
      matchDeviceTimezone(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        zones,
      ),
    );
  }, [zones]);

  const { groups, byZone } = useMemo(() => {
    const now = new Date();
    const byZone = new Map<string, ZoneOption>();
    const groups: ZoneGroup[] = [];
    const regions = new Map<string, ZoneGroup>();
    const unlisted =
      chosen !== null && chosen !== "" && !zones.includes(chosen)
        ? chosen
        : null;
    if (unlisted !== null) {
      const option: ZoneOption = {
        zone: unlisted,
        label: t("fields.timezone.notRecognised", { zone: unlisted }),
        search: unlisted.toLowerCase(),
      };
      byZone.set(unlisted, option);
      groups.push({ value: t("fields.timezone.saved"), items: [option] });
    }
    for (const zone of zones) {
      const option = describeZone(zone, locale, now);
      byZone.set(zone, option);
      const region = zone.includes("/") ? (zone.split("/")[0] ?? zone) : zone;
      let group = regions.get(region);
      if (!group) {
        group = { value: region, items: [] };
        regions.set(region, group);
        groups.push(group);
      }
      group.items.push(option);
    }
    return { groups, byZone };
    // `chosen` only matters when it is not listed, which is the one case that
    // adds an option; a listed choice changes nothing here.
  }, [zones, locale, t, chosen]);

  const choose = (zone: string | null) => {
    if (value === undefined) {
      setOwn(zone);
    }
    onValueChange?.(zone);
  };

  const selected = chosen ? (byZone.get(chosen) ?? null) : null;

  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter((part) => part !== null)
      .join(" ") || undefined;

  // **Labelled here rather than by Base UI `Field`.** Inside a `Field` the
  // label points at the combobox's hidden form input and the toggle button
  // borrows its name too, so three elements answered to one label and a
  // screen reader heard the toggle called "Timezone".
  return (
    <div ref={wrapper} className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {/* `null` is "nothing chosen", which a controlled combobox needs to be
          able to say, so the item type admits it. */}
      <Combobox.Root<ZoneOption | null>
        items={groups}
        value={selected}
        onValueChange={(option) => choose(option?.zone ?? null)}
        itemToStringLabel={(option) => option?.label ?? ""}
        itemToStringValue={(option) => option?.zone ?? ""}
        isItemEqualToValue={(a, b) => a?.zone === b?.zone}
        filter={(option, query) =>
          option?.search.includes(normaliseQuery(query)) ?? false
        }
        name={name}
        required={required}
      >
        <div className="relative">
          <Combobox.Input
            id={inputId}
            placeholder={t("fields.timezone.placeholder")}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={cn(
              FIELD_CONTROL_CLASS,
              "pr-8",
              error ? "border-bad-dot" : null,
            )}
          />
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-ink-3"
          />
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50">
            <Combobox.Popup className="max-h-72 w-[var(--anchor-width)] overflow-y-auto rounded-control border border-line-2 bg-surface py-1 shadow-lg">
              <Combobox.Empty className="px-2.5 py-2 text-sm text-ink-3">
                {t("fields.timezone.noMatch")}
              </Combobox.Empty>
              <Combobox.List>
                {(group: ZoneGroup) => (
                  <Combobox.Group key={group.value} items={group.items}>
                    <Combobox.GroupLabel className="px-2.5 pt-2 pb-1 text-xs font-semibold text-ink-3">
                      {group.value}
                    </Combobox.GroupLabel>
                    <Combobox.Collection>
                      {(option: ZoneOption) => (
                        <Combobox.Item
                          key={option.zone}
                          value={option}
                          className="cursor-default px-2.5 py-1.5 text-sm text-ink data-[highlighted]:bg-raised data-[selected]:font-semibold"
                        >
                          {option.label}
                        </Combobox.Item>
                      )}
                    </Combobox.Collection>
                  </Combobox.Group>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {device !== null && device !== chosen ? (
        <button
          type="button"
          onClick={() => choose(device)}
          className="w-fit text-xs font-medium text-brand-text hover:underline"
        >
          {t("fields.timezone.useThisDevice", { zone: device })}
        </button>
      ) : null}
      {description ? (
        <p id={descriptionId} className="text-xs text-ink-3">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
