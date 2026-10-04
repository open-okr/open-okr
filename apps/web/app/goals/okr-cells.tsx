"use client";

import type { QualityStatus } from "@openokr/method";
import { Chip, cn, useTranslations } from "@openokr/ui";
import { useEffect, useRef, useState } from "react";

/**
 * The cells of the OKR list, each edited where it is read (P9-T07a-a,
 * docs/design/p9-t00-okr-writing.md §4.2).
 *
 * Every cell follows UIUX-PLAN §4's inline edit: it reads as text until it is
 * clicked or reached with Tab, Enter or leaving it commits, Escape puts the
 * stored value back, and an unchanged value sends nothing. A real control
 * rather than `contenteditable`, so the keyboard reaches it, it carries its
 * own accessible name, and the accessibility scan reads it as what it is.
 *
 * **A reader without edit access gets text, not a disabled control.** A field
 * that looks editable and refuses the click is a promise the screen breaks;
 * plain text says what is true (§4.5).
 *
 * **A cell follows the cache unless somebody is typing in it.** The value can
 * move under it: another tab's write, a refusal rolled back, a conflict taken
 * from somebody else. While the reader is in the field, their draft wins.
 */

const FIELD =
  "rounded-control border border-transparent bg-transparent px-1.5 py-0.5 text-ink outline-none hover:border-line focus:border-brand focus:bg-surface";

/** Keeps a draft in step with the stored value while the field is not in use. */
function useDraft<T>(value: T): {
  readonly draft: T;
  readonly setDraft: (next: T) => void;
  readonly field: React.RefObject<HTMLInputElement | null>;
} {
  const [draft, setDraft] = useState(value);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== field.current) {
      setDraft(value);
    }
  }, [value]);
  return { draft, setDraft, field };
}

/** Enter leaves the field, which commits it; Escape puts the stored value back. */
const keys =
  (revert: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      revert();
      // Reverted first, so the blur that follows finds nothing to commit.
      const field = event.currentTarget;
      requestAnimationFrame(() => field.blur());
    }
  };

/** A title or a unit. Empty is refused for a title and allowed for a unit. */
export function InlineText({
  value,
  label,
  readOnly,
  bold,
  allowEmpty,
  placeholder,
  onDraft,
  onSave,
}: {
  readonly value: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly bold?: boolean;
  /** For a unit, where nothing is a real answer. */
  readonly allowEmpty?: boolean;
  readonly placeholder?: string;
  /** Called as the reader types, for the coaching chips beside the cell. */
  readonly onDraft?: (draft: string | null) => void;
  readonly onSave: (next: string) => void;
}) {
  const { draft, setDraft, field } = useDraft(value);
  const size = bold ? "text-sm font-bold" : "text-xs";

  if (readOnly) {
    return (
      <span className={cn("truncate px-1.5 text-ink", size)}>{value}</span>
    );
  }

  const commit = () => {
    onDraft?.(null);
    const next = draft.trim();
    if ((next === "" && !allowEmpty) || next === value) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  return (
    <input
      ref={field}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraft?.(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={keys(() => {
        setDraft(value);
        onDraft?.(null);
      })}
      className={cn("w-full truncate", FIELD, size)}
    />
  );
}

/** A number: a value, a target or a baseline. */
export function InlineNumber({
  value,
  label,
  readOnly,
  wide,
  onSave,
}: {
  readonly value: number;
  readonly label: string;
  readonly readOnly: boolean;
  readonly wide?: boolean;
  readonly onSave: (next: number) => void;
}) {
  const { draft, setDraft, field } = useDraft(String(value));

  if (readOnly) {
    return (
      <span className="px-1 text-xs font-semibold tabular-nums text-ink">
        {value}
      </span>
    );
  }

  const commit = () => {
    const next = Number(draft);
    if (draft.trim() === "" || Number.isNaN(next) || next === value) {
      setDraft(String(value));
      return;
    }
    onSave(next);
  };

  return (
    <input
      ref={field}
      type="number"
      step="any"
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={keys(() => setDraft(String(value)))}
      className={cn(
        "text-right text-xs font-semibold tabular-nums",
        wide ? "w-20" : "w-14",
        FIELD,
      )}
    />
  );
}

/** A due date, or none. */
export function InlineDate({
  value,
  label,
  readOnly,
  onSave,
}: {
  readonly value: string | null;
  readonly label: string;
  readonly readOnly: boolean;
  readonly onSave: (next: string | null) => void;
}) {
  const { t } = useTranslations();
  const { draft, setDraft, field } = useDraft(value ?? "");

  if (readOnly) {
    return (
      <span className="px-1 text-xs tabular-nums text-ink-3">
        {value ?? t("okrList.noDueDate")}
      </span>
    );
  }

  const commit = () => {
    const next = draft === "" ? null : draft;
    if (next === value) {
      return;
    }
    onSave(next);
  };

  return (
    <input
      ref={field}
      type="date"
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={keys(() => setDraft(value ?? ""))}
      className={cn("w-32 text-xs tabular-nums", FIELD)}
    />
  );
}

export interface Person {
  readonly id: string;
  readonly name: string;
}

/**
 * A champion or a key result owner. Saved as soon as it changes: a choice
 * from a list has no half-typed state to protect.
 */
export function MemberPicker({
  value,
  members,
  label,
  readOnly,
  allowNone,
  onSave,
}: {
  readonly value: Person | null;
  readonly members: readonly Person[];
  readonly label: string;
  readonly readOnly: boolean;
  /** A key result may be left without an owner; KR-3 then says so. */
  readonly allowNone?: boolean;
  readonly onSave: (memberId: string | null) => void;
}) {
  const { t } = useTranslations();
  if (readOnly) {
    return (
      <span className="truncate px-1 text-xs text-ink-2">
        {value?.name ?? t("okrList.nobody")}
      </span>
    );
  }
  // Somebody no longer in the directory still shows as who they are.
  const options =
    value && !members.some((member) => member.id === value.id)
      ? [value, ...members]
      : members;
  return (
    <select
      aria-label={label}
      value={value?.id ?? ""}
      onChange={(event) => {
        const next = event.target.value === "" ? null : event.target.value;
        if (next !== (value?.id ?? null)) {
          onSave(next);
        }
      }}
      className={cn("max-w-36 truncate text-xs", FIELD)}
    >
      {allowNone || value === null ? (
        <option value="">{t("okrList.nobody")}</option>
      ) : null}
      {options.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The reason an eased target needs, asked under the row that eased it
 * (METHOD v2 §2.9). Enter saves, Escape puts the old target back.
 */
export function ReasonField({
  from,
  to,
  onSave,
  onCancel,
}: {
  readonly from: number;
  readonly to: number;
  readonly onSave: (reason: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslations();
  const [reason, setReason] = useState("");
  const label = t("okrList.whyEase", { from: String(from), to: String(to) });
  return (
    <div
      data-testid="target-reason"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-warn-bg px-3.5 py-1.5 pl-14 text-xs"
    >
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-ink-2">{label}</span>
        <input
          ref={(node) => node?.focus()}
          value={reason}
          aria-label={label}
          placeholder={t("okrList.reasonPlaceholder")}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && reason.trim() !== "") {
              onSave(reason.trim());
            }
            if (event.key === "Escape") {
              onCancel();
            }
          }}
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-1 text-ink outline-none focus:border-brand"
        />
      </label>
      <button
        type="button"
        disabled={reason.trim() === ""}
        onClick={() => onSave(reason.trim())}
        className="rounded-control px-2 py-1 font-semibold text-brand-text disabled:text-ink-4"
      >
        {t("common.save")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-control px-2 py-1 text-ink-3"
      >
        {t("common.cancel")}
      </button>
    </div>
  );
}

export interface ShownVerdict {
  readonly id: string;
  readonly status: QualityStatus;
  readonly prompt: string;
}

/**
 * The checks a cell coaches on, as the reader types (§4.2). Each chip links to
 * its rule, so the prompt is one press from the reason behind it.
 */
export function VerdictChips({
  verdicts,
}: {
  readonly verdicts: readonly ShownVerdict[];
}) {
  if (verdicts.length === 0) {
    return null;
  }
  return (
    <span
      className="flex flex-wrap gap-1 px-1.5 pt-0.5"
      data-testid="live-verdicts"
    >
      {verdicts.map((verdict) => (
        <a
          key={verdict.id}
          href={`/method/${verdict.id}`}
          title={verdict.prompt}
          className="no-underline"
        >
          <Chip
            tone={
              verdict.status === "fail"
                ? "bad"
                : verdict.status === "warn"
                  ? "warn"
                  : "neutral"
            }
          >
            {verdict.id}
          </Chip>
        </a>
      ))}
    </span>
  );
}
