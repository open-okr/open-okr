"use client";

import type { Comparable } from "@openokr/core";
import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import type { Conflict } from "./conflict.ts";
import { READ_FIELD } from "./read-field.ts";

/**
 * A save refused because somebody changed the same field since it was read
 * (docs/design/optimistic-concurrency.md V4, plan 0.7.0 D3).
 *
 * One notice for every edit screen, the same shape the OKR tree draws: who
 * changed it, what it reads now, what this person sent, and the two ways
 * out. Keep mine sends it again made from what is stored now; take theirs
 * drops it, and the notice reads the page again so it shows what is stored.
 *
 * `labels` turns a stored value into words: a member id into a name, a
 * status into its label. A value with no label is shown as it is.
 */
export function ConflictNotice({
  conflict,
  labels,
  pending,
  onKeepMine,
  onTakeTheirs,
}: {
  readonly conflict: Conflict;
  readonly labels?: Readonly<Record<string, string>>;
  readonly pending?: boolean;
  readonly onKeepMine: () => void;
  readonly onTakeTheirs: () => void;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const one = (
    value: Comparable | Readonly<Record<string, Comparable>>,
  ): string => {
    if (value === null || value === "") {
      return t("conflict.none");
    }
    if (typeof value === "boolean") {
      return value ? t("conflict.yes") : t("conflict.no");
    }
    if (Array.isArray(value)) {
      // A list: a cycle's levels, or its session dates, one after another.
      const entries = value as readonly (
        | Comparable
        | Readonly<Record<string, Comparable>>
      )[];
      return entries.length === 0
        ? t("conflict.none")
        : entries.map((entry) => one(entry)).join(", ");
    }
    if (typeof value === "object") {
      // One session date: its name and its day.
      return Object.values(value)
        .map((entry) => one(entry as Comparable))
        .join(" ");
    }
    return labels?.[String(value)] ?? String(value);
  };
  const words = (values: Readonly<Record<string, Comparable>>): string =>
    Object.values(values)
      .map((value) => one(value))
      .join("; ");

  return (
    <div
      role="alert"
      data-testid="conflict"
      className="flex flex-wrap items-center gap-2 rounded-control border border-warn-dot bg-warn-bg px-3 py-2 text-xs text-ink-2"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>
          {t("conflict.changedSinceYouRead", {
            name: conflict.changedBy ?? t("conflict.somebody"),
            value: words(conflict.current),
          })}
        </span>
        <span className="text-ink-3">
          {t("conflict.yoursWas", { value: words(conflict.mine) })}
        </span>
      </span>
      <Button type="button" size="sm" pending={pending} onClick={onKeepMine}>
        {t("conflict.keepMine")}
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          onTakeTheirs();
          // The page is read again, so whatever it draws shows what is
          // stored. The router is asked for only here, where a conflict has
          // already been answered by the server.
          router.refresh();
        }}
      >
        {t("conflict.takeTheirs")}
      </Button>
    </div>
  );
}

/** The hidden field a form carries what it read in, as JSON. */
export function ReadField({
  read,
}: {
  readonly read: Readonly<Record<string, Comparable>>;
}) {
  return <input type="hidden" name={READ_FIELD} value={JSON.stringify(read)} />;
}

/**
 * Keep mine and take theirs for a form whose action returns a `conflict`.
 *
 * The form's own submit is remembered, so keep mine can send it again with
 * the stored values as what was read; the server then compares against
 * those, and the person's values are written. Take theirs puts the notice
 * away while the notice refreshes the page, which brings the stored values
 * in, and a form keyed on what it read is drawn again from them.
 */
export function useConflictForm<
  S extends { readonly conflict?: Conflict | null },
>(state: S, formAction: (formData: FormData) => void) {
  const sent = useRef<FormData | null>(null);
  // The state whose conflict was answered, so its notice goes away.
  const [answered, setAnswered] = useState<S | null>(null);
  const [resending, startResend] = useTransition();
  const conflict = state === answered ? null : (state.conflict ?? null);

  return {
    conflict,
    resending,
    onSubmit: (event: FormEvent<HTMLFormElement>) => {
      sent.current = new FormData(event.currentTarget);
    },
    keepMine: () => {
      const before = sent.current;
      if (!before || !conflict) {
        return;
      }
      const again = new FormData();
      for (const [name, value] of before.entries()) {
        again.append(name, value);
      }
      let read: Record<string, Comparable> = {};
      try {
        read = JSON.parse(String(before.get(READ_FIELD) ?? "{}"));
      } catch {
        // A form that read nothing has nothing to merge.
      }
      again.set(READ_FIELD, JSON.stringify({ ...read, ...conflict.current }));
      sent.current = again;
      setAnswered(state);
      startResend(() => formAction(again));
    },
    takeTheirs: () => setAnswered(state),
  };
}
