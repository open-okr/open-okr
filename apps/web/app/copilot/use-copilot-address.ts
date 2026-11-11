"use client";

/**
 * The open conversation's place in the address: `?copilot=<threadId>` (plan
 * 0.8.1 CP2, screen S-39).
 *
 * The OKR drawer does the same with `?okr=` (`goals/okr-drawer.tsx`), and for
 * the same reasons: a reload comes back to the conversation, Back closes what
 * opening it opened, and a conversation can be linked to. The address changes
 * through the history API rather than a navigation, so opening one does not
 * render the page again on the server.
 */
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** The parameter, in one place. */
const COPILOT_PARAM = "copilot";

export function useCopilotAddress(): {
  /** The conversation the address names, or null. */
  readonly addressed: string | null;
  /**
   * Names a conversation, or none. `push` is a step Back can undo, which is
   * what opening one from History is; everything else replaces.
   */
  readonly write: (threadId: string | null, how: "push" | "replace") => void;
} {
  const params = useSearchParams();
  const addressed = params.get(COPILOT_PARAM);

  const write = useCallback(
    (threadId: string | null, how: "push" | "replace") => {
      // From the window rather than from `params`, so a write right after
      // another one builds on it instead of on the render before.
      const next = new URLSearchParams(window.location.search);
      if (threadId === null) {
        next.delete(COPILOT_PARAM);
      } else {
        next.set(COPILOT_PARAM, threadId);
      }
      const query = next.toString();
      const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      if (
        url ===
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      ) {
        return;
      }
      if (how === "push") {
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    },
    [],
  );

  return { addressed, write };
}
