"use client";

import { Combobox } from "@base-ui-components/react/combobox";
import { ChevronDown } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Avatar, avatarToneFor } from "../components/avatar.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";
import { FIELD_CONTROL_CLASS } from "./text-input.tsx";

/** One thing the picker offers: a member, a space, a goal, a KPI. */
export interface EntityOption {
  readonly id: string;
  /** Its name, or a goal's title. What is shown once it is chosen. */
  readonly label: string;
  /** A member's job title, or a goal's short id: read with the name. */
  readonly detail?: string | null;
  /** Drawn with the initials avatar a member has everywhere else. */
  readonly avatar?: boolean;
  /** A word beside it, such as "Agent", so an agent is never mistaken for a person. */
  readonly badge?: string | null;
}

export interface EntityPickerProps {
  readonly label: string;
  /** The label is the field's accessible name only, as in a table cell. */
  readonly hideLabel?: boolean;
  /** The form field the chosen id is posted as. Nothing chosen posts "". */
  readonly name?: string;
  readonly id?: string;
  /** Controlled: the chosen id, or null for none. */
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onValueChange?: (id: string | null) => void;
  readonly options: readonly EntityOption[];
  /**
   * The stored choice, when it may not be among `options`: a member who has
   * left the directory, a space the reader can no longer add to. It still
   * shows as who or what it is, rather than as an empty field.
   */
  readonly current?: EntityOption | null;
  /**
   * The words for choosing nobody or nothing. Offered only when given, and
   * given only where the contract takes null.
   */
  readonly noneLabel?: string;
  /**
   * Asks the server for matches as the person types, once there are more
   * options than the browser filters (§4.10), or when there are none at all:
   * a page that cannot send every goal sends none and lets the picker ask.
   * A list in between is filtered where it is.
   */
  readonly search?: (text: string) => Promise<readonly EntityOption[]>;
  readonly placeholder?: string;
  readonly description?: ReactNode;
  /** Why the choice cannot be saved as it is. Shown and announced while set. */
  readonly error?: string | null;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** How many options the browser filters itself (§4.10). */
export const ENTITY_PICKER_BROWSER_LIMIT = 200;

/** How long typing pauses before the server is asked. */
const SEARCH_PAUSE_MS = 150;

/** Lower-cased, accents set aside, spaces collapsed. */
function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** What an option says, as one string: two options saying it alike are one. */
function said(option: EntityOption | null | undefined): string {
  return option
    ? [option.id, option.label, option.detail ?? "", option.badge ?? ""].join(
        "\u0000",
      )
    : "";
}

/**
 * The value from the render that first said it, for as long as `key` stays
 * the same.
 *
 * A screen draws its options anew whenever it draws, and the combobox tells a
 * changed value by its identity rather than its content: a new chosen option
 * put the stored name back over what the person was typing. A diagram card
 * draws whenever anything on the canvas moves, so it happened mid-word.
 */
function useSame<T>(value: T, key: string): T {
  const held = useRef({ key, value });
  if (held.current.key !== key) {
    held.current = { key, value };
  }
  return held.current.value;
}

function matches(option: EntityOption, query: string): boolean {
  const wanted = folded(query);
  if (wanted === "") {
    return true;
  }
  return folded(`${option.label} ${option.detail ?? ""}`).includes(wanted);
}

/**
 * A person, a space, a goal or a KPI chosen from a list that can be searched
 * (docs/design/guided-inputs.md §4.10), on Base UI `Combobox`.
 *
 * Typing narrows the list by name, and by a member's title or a goal's short
 * id. A member is drawn with their avatar, their name and their title, and an
 * agent says it is one. A stored choice that is no longer in the list still
 * shows. "Nobody" is offered only where `noneLabel` says the contract allows
 * it. Up to two hundred options are filtered here; above that, `search` asks
 * the server as the person types.
 */
export function EntityPicker({
  label,
  hideLabel,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  options,
  current,
  noneLabel,
  search,
  placeholder,
  description,
  error,
  required,
  disabled,
  className,
  inputClassName,
  onBlur,
  onKeyDown,
}: EntityPickerProps) {
  const { t } = useTranslations();
  const [own, setOwn] = useState<string | null>(defaultValue ?? null);
  const chosen = value !== undefined ? value : own;
  const wrapper = useRef<HTMLDivElement>(null);
  useFormReset(wrapper, () => setOwn(defaultValue ?? null));

  const none = useMemo<EntityOption | null>(
    () => (noneLabel === undefined ? null : { id: "", label: noneLabel }),
    [noneLabel],
  );
  const sameOptions = useSame(
    options,
    options.map((option) => said(option)).join("\u0001"),
  );
  const sameCurrent = useSame(current ?? null, said(current));
  // The stored choice first when the list has lost it, then the list.
  const listed = useMemo(() => {
    const all =
      sameCurrent && !sameOptions.some((option) => option.id === sameCurrent.id)
        ? [sameCurrent, ...sameOptions]
        : [...sameOptions];
    return none ? [none, ...all] : all;
  }, [sameOptions, sameCurrent, none]);

  // Above the browser's share, the server answers what is typed.
  const remote =
    search !== undefined &&
    (options.length === 0 || options.length > ENTITY_PICKER_BROWSER_LIMIT);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly EntityOption[]>([]);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    if (!remote || search === undefined) {
      return undefined;
    }
    const text = query.trim();
    if (text === "") {
      setFound([]);
      setLooking(false);
      return undefined;
    }
    let stale = false;
    setLooking(true);
    const timer = setTimeout(() => {
      search(text)
        .then((answer) => {
          if (!stale) {
            setFound(answer);
          }
        })
        .catch(() => {
          if (!stale) {
            setFound([]);
          }
        })
        .finally(() => {
          if (!stale) {
            setLooking(false);
          }
        });
    }, SEARCH_PAUSE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [remote, search, query]);

  // The server's answer the person chose, kept once the answers move on.
  const [picked, setPicked] = useState<EntityOption | null>(null);
  // **Everything the combobox may hold as chosen is among its items.** It
  // drops a chosen value its items do not include, so a choice from the
  // server's answers posted nothing until they were here too.
  const items = useMemo(() => {
    if (!remote) {
      return listed;
    }
    const seen = new Set<string>();
    const all: EntityOption[] = [];
    for (const option of [...listed, ...(picked ? [picked] : []), ...found]) {
      if (!seen.has(option.id)) {
        seen.add(option.id);
        all.push(option);
      }
    }
    return all;
  }, [remote, listed, picked, found]);
  const byId = useMemo(() => {
    const map = new Map<string, EntityOption>();
    for (const option of items) {
      map.set(option.id, option);
    }
    return map;
  }, [items]);
  const selected =
    chosen === null || chosen === ""
      ? (none ?? null)
      : (byId.get(chosen) ?? null);

  const choose = (option: EntityOption | null) => {
    const next = option === null || option.id === "" ? null : option.id;
    if (remote && option !== null && option.id !== "") {
      setPicked(option);
    }
    if (value === undefined) {
      setOwn(next);
    }
    onValueChange?.(next);
  };

  const generated = useId();
  const inputId = id ?? generated;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter((part) => part !== null)
      .join(" ") || undefined;

  const typing =
    query.trim() !== "" && query.trim() !== (selected?.label ?? "");
  const remoteItems = [
    ...(none ? [none] : []),
    ...(selected && selected !== none && !found.includes(selected)
      ? [selected]
      : []),
    ...found,
  ];

  // **Labelled here rather than by Base UI `Field`**, for the reason the
  // timezone field gives: inside a `Field` the label points at the hidden
  // form input, and the toggle borrows its name too.
  return (
    <div ref={wrapper} className={cn("flex min-w-0 flex-col gap-1", className)}>
      {hideLabel ? null : (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <Combobox.Root<EntityOption | null>
        items={items}
        {...(remote ? { filteredItems: typing ? remoteItems : listed } : {})}
        value={selected}
        onValueChange={choose}
        onInputValueChange={(text) => setQuery(text)}
        itemToStringLabel={(option) => option?.label ?? ""}
        itemToStringValue={(option) => option?.id ?? ""}
        isItemEqualToValue={(a, b) => a?.id === b?.id}
        filter={
          remote
            ? null
            : (option, text) =>
                option === null ? false : matches(option, text)
        }
        name={name}
        required={required}
        disabled={disabled}
      >
        <div className="relative">
          <Combobox.Input
            id={inputId}
            placeholder={placeholder}
            aria-label={hideLabel ? label : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            // A press on the picker is the picker's. Left to bubble, it was
            // also a press on whatever held it: a diagram card opened its
            // drawer, which took the focus the picker needed.
            onClick={(event) => event.stopPropagation()}
            className={cn(
              FIELD_CONTROL_CLASS,
              "pr-7",
              error ? "border-bad-dot" : null,
              inputClassName,
            )}
          />
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-3"
          />
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50">
            {/* React bubbles a press in the list through the picker's own
                parents, though the list is drawn elsewhere, so it is held
                here for the same reason. */}
            <Combobox.Popup
              onClick={(event) => event.stopPropagation()}
              className="max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-control border border-line-2 bg-surface py-1 shadow-lg"
            >
              {remote && !typing ? (
                <p className="px-2.5 py-1.5 text-xs text-ink-3">
                  {options.length === 0
                    ? t("fields.entity.typeToSearch")
                    : t("fields.entity.typeToFind", { count: options.length })}
                </p>
              ) : null}
              {remote && typing && looking ? (
                <p className="px-2.5 py-1.5 text-xs text-ink-3" role="status">
                  {t("fields.entity.looking")}
                </p>
              ) : null}
              <Combobox.Empty className="px-2.5 py-2 text-sm text-ink-3">
                {remote && looking ? null : t("fields.entity.noMatch")}
              </Combobox.Empty>
              <Combobox.List>
                {(option: EntityOption) => (
                  <Combobox.Item
                    key={option.id === "" ? "none" : option.id}
                    value={option}
                    className="flex cursor-default items-center gap-2 px-2.5 py-1.5 text-sm text-ink data-[highlighted]:bg-raised data-[selected]:font-semibold"
                  >
                    {option.avatar ? (
                      <Avatar
                        aria-hidden="true"
                        name={option.label}
                        size="sm"
                        tone={avatarToneFor(option.id)}
                        className="shrink-0"
                      />
                    ) : null}
                    <span className="min-w-0 truncate">{option.label}</span>
                    {option.detail ? (
                      <span className="min-w-0 truncate text-xs font-normal text-ink-3">
                        {option.detail}
                      </span>
                    ) : null}
                    {option.badge ? (
                      <span className="shrink-0 rounded-sm bg-raised px-1 text-[10px] font-semibold text-ink-3">
                        {option.badge}
                      </span>
                    ) : null}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
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
