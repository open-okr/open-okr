"use client";

import { Kbd, useKeyboardShortcut } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** A neighbour of the item on screen: where it is and what to call it. */
export interface Neighbour {
  readonly href: string;
  /** "Previous initiative", already translated, for the link and the overlay. */
  readonly label: string;
}

/**
 * The one before and the one after on a detail screen, as links and as `[`
 * and `]` (UIUX-PLAN §4, the Keyboard row; plan 0.7.0, U2).
 *
 * Links as well as keys, because nothing is reachable only by the keyboard
 * (UIUX-PLAN §1). A missing neighbour has neither, so the first item offers
 * no `[` and the overlay does not list one.
 */
export function PreviousNext({
  previous,
  next,
}: {
  readonly previous: Neighbour | null;
  readonly next: Neighbour | null;
}) {
  if (previous === null && next === null) {
    return null;
  }
  return (
    <nav className="flex items-center gap-3 text-xs">
      {previous ? <Step neighbour={previous} keys="[" arrow="←" /> : null}
      {next ? <Step neighbour={next} keys="]" arrow="→" /> : null}
    </nav>
  );
}

function Step({
  neighbour,
  keys,
  arrow,
}: {
  readonly neighbour: Neighbour;
  readonly keys: "[" | "]";
  readonly arrow: string;
}) {
  const router = useRouter();
  const { href, label } = neighbour;
  useKeyboardShortcut(
    {
      id: keys === "[" ? "detail.previous" : "detail.next",
      keys,
      description: label,
      group: "detail",
    },
    useCallback(() => router.push(href), [router, href]),
    { key: keys },
  );
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-ink-3 hover:text-brand-text"
    >
      {keys === "[" ? <span aria-hidden="true">{arrow}</span> : null}
      {label}
      {keys === "]" ? <span aria-hidden="true">{arrow}</span> : null}
      <Kbd aria-hidden="true">{keys}</Kbd>
    </Link>
  );
}
