"use client";

import { Field } from "@base-ui-components/react/field";
import { DEVICE_CODE_ALPHABET } from "@openokr/formats";
import {
  type ClipboardEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn.ts";

/** Which characters a code is made of. */
export type CodeCharacters = "digits" | "letters-and-digits" | "device";

export interface CodeInputProps {
  /** The visible label, linked to the one real input. */
  readonly label: string;
  readonly description?: ReactNode;
  /** Why the last code was refused. Shown and announced while set. */
  readonly error?: string | null;
  /** The cells, in groups: `[6]`, `[5, 5]`, `[4, 4]`. */
  readonly groups: readonly number[];
  readonly characters: CodeCharacters;
  /** The characters typed so far, without separators. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Called once each time the last cell is filled. */
  readonly onComplete?: (value: string) => void;
  /** While the code is being checked: the cells hold still. */
  readonly busy?: boolean;
  /** `one-time-code` for an authenticator code; off for anything else. */
  readonly autoComplete?: string;
  readonly autoFocus?: boolean;
  readonly id?: string;
}

const ALLOWED: Record<CodeCharacters, (char: string) => boolean> = {
  digits: (char) => char >= "0" && char <= "9",
  "letters-and-digits": (char) => /^[A-Za-z0-9]$/.test(char),
  device: (char) => DEVICE_CODE_ALPHABET.includes(char),
};

/** What a typed or pasted text leaves in the cells: allowed characters only. */
function normalise(text: string, characters: CodeCharacters, total: number) {
  let kept = "";
  for (const raw of text) {
    const char = characters === "device" ? raw.toUpperCase() : raw;
    if (ALLOWED[characters](char)) {
      kept += char;
    }
  }
  return kept.slice(0, total);
}

/**
 * A one-time code, one cell per character (docs/design/guided-inputs.md §4.5).
 *
 * **One real input holds the value and the cells are drawn under it.** A
 * password manager, a phone's one-time-code autofill and a screen reader each
 * see a single field, which a row of separate inputs breaks for all three.
 * The input sits over the cells with its text transparent, so typing, the
 * caret's movement, Backspace and selection are the browser's own.
 *
 * A paste fills every cell, whatever separates the characters, and when the
 * last cell is filled `onComplete` runs once, so a code is submitted without a
 * button press. A refusal empties the cells through `value` and sets `error`,
 * and the field takes focus back so the next attempt starts at the first cell.
 */
export function CodeInput({
  label,
  description,
  error,
  groups,
  characters,
  value,
  onChange,
  onComplete,
  busy,
  autoComplete = "off",
  autoFocus,
  id,
}: CodeInputProps) {
  const total = groups.reduce((sum, size) => sum + size, 0);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);

  useEffect(() => {
    if (error) {
      input.current?.focus();
    }
  }, [error]);

  const take = (text: string) => {
    const next = normalise(text, characters, total);
    onChange(next);
    setCaret(next.length);
    if (next.length === total && value.length !== total) {
      onComplete?.(next);
    }
  };

  const active = Math.min(caret, total - 1);
  // Each group by the position of its first cell, which is what identifies it
  // in a layout that never reorders.
  const layout = groups.map((size, group) => ({
    first: groups.slice(0, group).reduce((sum, earlier) => sum + earlier, 0),
    size,
  }));

  return (
    <Field.Root
      invalid={error ? true : undefined}
      className="flex flex-col gap-1"
    >
      <Field.Label className="text-sm font-medium text-ink-2">
        {label}
      </Field.Label>
      <div className="relative w-fit">
        <div aria-hidden className="flex items-center gap-2">
          {layout.map(({ first, size }) => (
            <Fragment key={first}>
              {first > 0 ? <span className="text-ink-3">-</span> : null}
              <span data-code-group className="flex gap-1.5">
                {Array.from({ length: size }, (_, offset) => {
                  const position = first + offset;
                  return (
                    <span
                      key={position}
                      data-code-cell
                      className={cn(
                        "flex size-9 items-center justify-center rounded-control border bg-surface font-mono text-lg text-ink",
                        focused && position === active
                          ? "border-brand ring-2 ring-brand-line"
                          : error
                            ? "border-bad-dot"
                            : "border-line-2",
                      )}
                    >
                      {value[position] ?? ""}
                    </span>
                  );
                })}
              </span>
            </Fragment>
          ))}
        </div>
        <Field.Control
          ref={input}
          id={id}
          value={value}
          readOnly={busy}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          inputMode={characters === "digits" ? "numeric" : "text"}
          autoCapitalize={characters === "device" ? "characters" : "off"}
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => take(event.currentTarget.value)}
          onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
            event.preventDefault();
            take(event.clipboardData.getData("text"));
          }}
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart ?? value.length)
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
        />
      </div>
      {description ? (
        <Field.Description className="text-xs text-ink-3">
          {description}
        </Field.Description>
      ) : null}
      {error ? (
        <Field.Error
          match
          role="alert"
          className="text-sm font-medium text-bad"
        >
          {error}
        </Field.Error>
      ) : null}
    </Field.Root>
  );
}
