"use client";

import { type ReactNode, useCallback, useRef } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { useKeyboardShortcut } from "./use-keyboard-shortcut.ts";

/**
 * A list the keyboard can walk (UIUX-PLAN.md §4, the Keyboard row; plan
 * 0.7.0, U2): `j` and `k` move the focus down and up the rows, `x` chooses
 * the row with the focus and `e` puts the caret in its edit control.
 *
 * **Marked rather than rendered here.** A row is any element inside with
 * `data-keyboard-row`, its edit control the element marked
 * `data-keyboard-edit` (or the first field inside it), its choice the one
 * marked `data-keyboard-select`, which is pressed, and where `j` and `k` land
 * the one marked `data-keyboard-focus` (or its first control). So a list the server draws
 * takes the keys without becoming a client component, and the list keeps its
 * own markup.
 *
 * **Only the keys the list has.** `x` and `e` are registered, and so listed
 * in the `?` overlay, only where `select` and `edit` say the list has them:
 * a key that does nothing is a dead button. One list per screen, because the
 * keys are the screen's.
 *
 * Nothing here is reachable only by the keyboard: a row is a link or a
 * control a pointer reaches as well.
 */
export function KeyboardList({
  children,
  edit,
  select,
  className,
}: {
  readonly children: ReactNode;
  /** The rows have an edit control, marked `data-keyboard-edit`. */
  readonly edit?: boolean;
  /** The rows can be chosen, by the control marked `data-keyboard-select`. */
  readonly select?: boolean;
  readonly className?: string;
}) {
  const { t } = useTranslations();
  const list = useRef<HTMLDivElement>(null);
  // The row the keys last moved to, for when the focus has left the list.
  const last = useRef(-1);

  const rows = useCallback(
    (): HTMLElement[] => [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-keyboard-row]") ??
        []),
    ],
    [],
  );

  /** The row holding the focus, or the one the keys last moved to. */
  const current = useCallback((): number => {
    const all = rows();
    const active = document.activeElement;
    const holding = all.findIndex(
      (row) => active instanceof Node && row.contains(active),
    );
    return holding >= 0 ? holding : Math.min(last.current, all.length - 1);
  }, [rows]);

  const move = useCallback(
    (by: 1 | -1) => {
      const all = rows();
      if (all.length === 0) {
        return;
      }
      const from = current();
      const to =
        from < 0
          ? by === 1
            ? 0
            : all.length - 1
          : Math.max(0, Math.min(all.length - 1, from + by));
      const row = all[to];
      if (!row) {
        return;
      }
      last.current = to;
      const target = landing(row);
      if (target) {
        target.focus();
      } else {
        // A row with nothing to focus takes the focus itself.
        row.tabIndex = -1;
        row.focus();
      }
      row.scrollIntoView?.({ block: "nearest" });
    },
    [rows, current],
  );

  const within = useCallback(
    (marker: string): HTMLElement | null => {
      const row = rows()[current()];
      return row?.querySelector<HTMLElement>(`[${marker}]`) ?? null;
    },
    [rows, current],
  );

  useKeyboardShortcut(
    {
      id: "list.next",
      keys: "j",
      description: t("shell.shortcuts.listNext"),
      group: "lists",
    },
    useCallback(() => move(1), [move]),
    { key: "j" },
  );
  useKeyboardShortcut(
    {
      id: "list.previous",
      keys: "k",
      description: t("shell.shortcuts.listPrevious"),
      group: "lists",
    },
    useCallback(() => move(-1), [move]),
    { key: "k" },
  );

  return (
    <div ref={list} className={className}>
      {select ? <SelectKey within={within} /> : null}
      {edit ? <EditKey within={within} /> : null}
      {children}
    </div>
  );
}

/**
 * Where `j` and `k` put the focus in a row: the control marked
 * `data-keyboard-focus`, or else its first link or control, whichever is
 * drawn. A row whose first control is a text field marks another, so the
 * next `j` is not typed into the field.
 */
function landing(row: HTMLElement): HTMLElement | null {
  const candidates = [
    ...row.querySelectorAll<HTMLElement>("[data-keyboard-focus]"),
    ...row.querySelectorAll<HTMLElement>(FOCUSABLE),
  ];
  // Drawn first: a control hidden on a phone takes no focus. Where nothing
  // reports a box, as in a test's document, the first candidate stands.
  return (
    candidates.find((element) => element.getClientRects().length > 0) ??
    candidates[0] ??
    null
  );
}

/** What `j` and `k` put the focus on in a row: its first link or control. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The fields `e` puts the caret in. */
const FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], button:not([disabled])';

type Within = (marker: string) => HTMLElement | null;

/** `x`, mounted only where the list's rows can be chosen. */
function SelectKey({ within }: { readonly within: Within }) {
  const { t } = useTranslations();
  useKeyboardShortcut(
    {
      id: "list.select",
      keys: "x",
      description: t("shell.shortcuts.listSelect"),
      group: "lists",
    },
    useCallback(() => within("data-keyboard-select")?.click(), [within]),
    { key: "x" },
  );
  return null;
}

/** `e`, mounted only where the list's rows can be edited. */
function EditKey({ within }: { readonly within: Within }) {
  const { t } = useTranslations();
  useKeyboardShortcut(
    {
      id: "list.edit",
      keys: "e",
      description: t("shell.shortcuts.listEdit"),
      group: "lists",
    },
    useCallback(() => {
      const marked = within("data-keyboard-edit");
      const field = marked?.matches(FIELD)
        ? marked
        : marked?.querySelector<HTMLElement>(FIELD);
      field?.focus();
    }, [within]),
    { key: "e" },
  );
  return null;
}
