"use client";

import type { ReactNode } from "react";

/**
 * One "Still needed here" item, as a way to the place it is filled in
 * (plan 0.8.0 F1).
 *
 * A link to an anchor on the same page, so it works without JavaScript and a
 * keyboard reaches it like any link. With JavaScript it also moves focus to
 * the first field in the card, so the next keystroke goes where the reader
 * meant, and outlines the card for a moment so the eye finds it.
 */
export function NeedLink({
  anchor,
  children,
}: {
  /** The id of the card or row that fills this item. */
  readonly anchor: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={`#${anchor}`}
      className="text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink hover:decoration-ink-3"
      data-testid="need-link"
      onClick={(event) => {
        const target = document.getElementById(anchor);
        if (!target) {
          return;
        }
        event.preventDefault();
        target.scrollIntoView({ block: "start" });
        window.history.replaceState(null, "", `#${anchor}`);
        const field = target.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable="true"]',
        );
        (field ?? target).focus({ preventScroll: true });
        target.setAttribute("data-need-flash", "");
        window.setTimeout(
          () => target.removeAttribute("data-need-flash"),
          1600,
        );
      }}
    >
      {children}
    </a>
  );
}
