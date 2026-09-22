"use client";

/**
 * ⌘⏎ submits the form the focus is inside (P8-G11).
 *
 * UIUX-PLAN.md §4 lists `⌘⏎ save` among the keyboard patterns. No form in
 * this product bound it: a grep for `metaKey` across `apps/web/app/admin`
 * returned nothing.
 *
 * **Attached to the form rather than to the window.** A settings screen holds
 * several independently saved forms, and a window listener would have to work
 * out which one the caret is in. The form already knows: the event bubbles to
 * it and to nothing else.
 */

import type { KeyboardEvent } from "react";
import { useCallback } from "react";

export function useSubmitShortcut(
  enabled = true,
): (event: KeyboardEvent<HTMLFormElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLFormElement>) => {
      if (!enabled || event.key !== "Enter") {
        return;
      }
      // Either modifier satisfies "⌘", the same rule
      // `use-keyboard-shortcut.ts` applies to every other shortcut here.
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      event.preventDefault();
      // `requestSubmit` runs the form's validation and fires a `submit`
      // event, which is what a server action is attached to. `submit()` does
      // neither and would post the form as a plain document navigation.
      event.currentTarget.requestSubmit();
    },
    [enabled],
  );
}
