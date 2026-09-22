"use client";

/**
 * Whether a form holds edits that have not been saved (P8-G11).
 *
 * **Compared against a snapshot rather than flagged on first keystroke.**
 * A flag is two lines shorter and says "unsaved" forever once somebody
 * touches a field, including after they typed a value and typed it back. On a
 * screen with 123 fields that false positive would fire the leave-guard on
 * most visits, and a guard that cries wolf is one people learn to click
 * through.
 *
 * The snapshot is a string rather than a structure because the comparison is
 * equality and nothing else reads it.
 */

import { type RefObject, useCallback, useEffect, useState } from "react";

function snapshot(form: HTMLFormElement): string {
  const parts: string[] = [];
  for (const [name, value] of new FormData(form).entries()) {
    // Next renders its own hidden fields into a server-action form. Their
    // values are stable, so including them would not break the comparison,
    // but they are not something a person typed.
    if (name.startsWith("$ACTION")) {
      continue;
    }
    parts.push(
      `${name}\u0000${typeof value === "string" ? value : value.name}`,
    );
  }
  return parts.join("\u0001");
}

export interface FormDirty {
  readonly dirty: boolean;
  /**
   * Takes the current values as the new baseline. Called after a save
   * succeeds, so the form stops reporting unsaved work without being
   * re-mounted.
   */
  markSaved(): void;
}

export function useFormDirty(
  form: RefObject<HTMLFormElement | null>,
): FormDirty {
  const [baseline, setBaseline] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const element = form.current;
    if (!element) {
      return;
    }
    const initial = snapshot(element);
    setBaseline(initial);
    setCurrent(initial);

    // Both events, because `input` misses a `<select>` in older engines and
    // `change` misses a keystroke in a text field.
    const onEdit = () => setCurrent(snapshot(element));
    element.addEventListener("input", onEdit);
    element.addEventListener("change", onEdit);
    return () => {
      element.removeEventListener("input", onEdit);
      element.removeEventListener("change", onEdit);
    };
  }, [form]);

  const markSaved = useCallback(() => {
    const element = form.current;
    if (!element) {
      return;
    }
    const now = snapshot(element);
    setBaseline(now);
    setCurrent(now);
  }, [form]);

  return {
    // Null until the first effect has run, which is the server render and the
    // first client paint. A form cannot be dirty before anybody could type.
    dirty: baseline !== null && current !== baseline,
    markSaved,
  };
}
