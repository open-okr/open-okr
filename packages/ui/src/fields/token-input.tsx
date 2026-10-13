"use client";

import { hostOf, isDomain, isHostName } from "@openokr/formats";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { useFormReset } from "./form-reset.ts";

export interface TokenInputProps {
  readonly label: string;
  /** The form field the entries are posted as, joined into one value. */
  readonly name?: string;
  readonly id?: string;
  /** What the posted value joins entries with: ", " unless said. */
  readonly joiner?: string;
  /** Controlled: the entries. */
  readonly value?: readonly string[];
  readonly defaultValue?: readonly string[];
  readonly onValueChange?: (entries: string[]) => void;
  /**
   * Why an entry is wrong, or null. The same rule the server refuses with,
   * so a chip is marked as the person makes it rather than after Save.
   */
  readonly check?: (entry: string) => string | null;
  /** How an entry is stored: a domain lower-cased, for instance. */
  readonly normalise?: (entry: string) => string;
  /**
   * A rule the kit knows, for a server page that cannot hand a function to
   * the browser: a domain (`isDomain`) or a host an AI call may reach
   * (`isHostName`), each lower-cased and checked with the server's own rule.
   */
  readonly rule?: "domain" | "host";
  /**
   * What separates entries. "any" is a comma, a space or a new line, for
   * domains, hosts and scopes; "commas" leaves spaces alone, for terms that
   * can be two words.
   */
  readonly separators?: "any" | "commas";
  /** The most entries the server keeps. */
  readonly max?: number;
  readonly placeholder?: string;
  readonly description?: ReactNode;
  /** Why the server refused the list. Shown and announced while set. */
  readonly error?: string | null;
  readonly disabled?: boolean;
  readonly className?: string;
}

const SPLIT = { any: /[,\s]+/, commas: /[,\n]+/ } as const;

/**
 * A list of short entries (docs/design/guided-inputs.md §4.11): domains,
 * hosts, scopes, terms. Each entry becomes a chip as it is typed or pasted,
 * separated by a comma, a space or a new line, and is checked where it
 * stands by the rule the server applies. A wrong chip is marked and says
 * why, and the form will not send while one is there. Backspace in an empty
 * box takes the last chip back, and each chip has its own remove button.
 *
 * The entries post as one value joined by `joiner`, which is what every
 * action this replaces already reads, so the server sees no difference
 * except that it is sent less that it has to refuse.
 */
export function TokenInput({
  label,
  name,
  id,
  joiner = ", ",
  value,
  defaultValue,
  onValueChange,
  check: givenCheck,
  normalise: givenNormalise,
  rule,
  separators = "any",
  max,
  placeholder,
  description,
  error,
  disabled,
  className,
}: TokenInputProps) {
  const { t } = useTranslations();
  const check =
    givenCheck ??
    (rule === "domain"
      ? (entry: string) =>
          isDomain(entry) ? null : t("fields.token.notADomain", { entry })
      : rule === "host"
        ? (entry: string) =>
            isHostName(entry) ? null : t("fields.token.notAHost", { entry })
        : undefined);
  // A host given as an address keeps only its host, as the save does.
  const normalise =
    givenNormalise ??
    (rule === "host"
      ? hostOf
      : rule === "domain"
        ? (entry: string) => entry.toLowerCase()
        : undefined);
  const [own, setOwn] = useState<readonly string[]>(defaultValue ?? []);
  const entries = value ?? own;
  const [draft, setDraft] = useState("");
  const [tooMany, setTooMany] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useFormReset(wrapper, () => {
    setOwn(defaultValue ?? []);
    setDraft("");
    setTooMany(false);
  });

  const generated = useId();
  const inputId = id ?? generated;
  const descriptionId = `${inputId}-description`;
  const problemsId = `${inputId}-problems`;

  const split = (text: string): string[] =>
    text
      .split(SPLIT[separators])
      .map((one) => one.trim())
      .filter((one) => one !== "")
      .map((one) => (normalise ? normalise(one) : one));

  const change = (next: string[]) => {
    if (value === undefined) {
      setOwn(next);
    }
    onValueChange?.(next);
  };

  /** Adds what was typed or pasted, once each, up to `max`. */
  const commit = (text: string) => {
    const next = [...entries];
    let refused = false;
    for (const entry of split(text)) {
      if (next.includes(entry)) {
        continue;
      }
      if (max !== undefined && next.length >= max) {
        refused = true;
        break;
      }
      next.push(entry);
    }
    setTooMany(refused);
    setDraft("");
    if (next.length !== entries.length) {
      change(next);
    }
  };

  const remove = (entry: string) => {
    setTooMany(false);
    change(entries.filter((one) => one !== entry));
  };

  const problems = check
    ? entries.flatMap((entry) => {
        const why = check(entry);
        return why === null ? [] : [{ entry, why }];
      })
    : [];

  // The form will not send while a chip is wrong: the box carries the first
  // reason as its own validity, so the browser holds the save and says it.
  useEffect(() => {
    input.current?.setCustomValidity(problems[0]?.why ?? "");
  });

  // What is typed and not yet a chip is sent too, so a Save pressed straight
  // after typing loses nothing.
  const posted = [...entries];
  for (const entry of split(draft)) {
    if (!posted.includes(entry)) {
      posted.push(entry);
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const separates =
      event.key === "," || (separators === "any" && event.key === " ");
    if (separates || (event.key === "Enter" && draft.trim() !== "")) {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && entries.length > 0) {
      event.preventDefault();
      remove(entries[entries.length - 1] as string);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (SPLIT[separators].test(pasted)) {
      event.preventDefault();
      commit(`${draft}${pasted}`);
    }
  };

  const describedBy =
    [
      description ? descriptionId : null,
      problems.length > 0 || error || tooMany ? problemsId : null,
    ]
      .filter((part) => part !== null)
      .join(" ") || undefined;

  return (
    <div ref={wrapper} className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-7.5 w-full flex-wrap items-center gap-1 rounded-control border border-line-2 bg-surface px-1.5 py-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line",
          problems.length > 0 || error ? "border-bad-dot" : null,
          disabled ? "opacity-60" : null,
        )}
      >
        {entries.length > 0 ? (
          <ul className="contents">
            {entries.map((entry) => {
              const wrong = problems.some((one) => one.entry === entry);
              return (
                <li
                  key={entry}
                  data-invalid={wrong ? "true" : undefined}
                  className={cn(
                    "inline-flex max-w-full items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-xs",
                    wrong
                      ? "bg-bad-bg text-bad ring-1 ring-bad-dot"
                      : "bg-raised text-ink-2",
                  )}
                >
                  <span className="truncate">{entry}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("fields.token.remove", { entry })}
                    onClick={() => remove(entry)}
                    className="rounded-sm px-0.5 text-ink-3 hover:text-ink"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <input
          ref={input}
          id={inputId}
          value={draft}
          disabled={disabled}
          placeholder={entries.length === 0 ? placeholder : undefined}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          aria-describedby={describedBy}
          aria-invalid={problems.length > 0 || error ? true : undefined}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            if (draft.trim() !== "") {
              commit(draft);
            }
          }}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none"
        />
      </div>
      {name ? (
        <input type="hidden" name={name} value={posted.join(joiner)} />
      ) : null}
      {description ? (
        <p id={descriptionId} className="text-xs text-ink-3">
          {description}
        </p>
      ) : null}
      {problems.length > 0 || error || tooMany ? (
        <div
          id={problemsId}
          aria-live="polite"
          className="flex flex-col gap-0.5"
        >
          {problems.map((one) => (
            <p key={one.entry} className="text-xs font-medium text-bad">
              {one.why}
            </p>
          ))}
          {tooMany && max !== undefined ? (
            <p className="text-xs font-medium text-bad">
              {t("fields.token.tooMany", { max })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-medium text-bad">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
