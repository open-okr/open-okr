"use client";

/**
 * Live session stage synchronisation hook (P4-T07a).
 *
 * Connects to the SSE endpoint and calls `onUpdate` whenever the facilitator
 * advances a stage or reveals an objective's score (P4-T10b-b). The caller decides what to do — typically `router.refresh()`
 * to re-fetch the session server component. The hook itself does not know about
 * router state; keeping that in the caller avoids coupling the hook to Next.js.
 *
 * Native `EventSource` reconnects automatically on disconnect. No polling, no
 * manual retry loop.
 */
import { useEffect } from "react";

export function useSessionLive(sessionId: string, onUpdate: () => void): void {
  useEffect(() => {
    const url = `/api/session/${sessionId}/live`;
    const source = new EventSource(url);

    source.addEventListener("session.stageChanged", () => {
      onUpdate();
    });

    // The reveal is its own event, because a client sitting on stage two has no
    // stage change to hear (P4-T10b-b).
    source.addEventListener("session.scoresRevealed", () => {
      onUpdate();
    });

    // Close the connection when the component unmounts.
    return () => {
      source.close();
    };
  }, [sessionId, onUpdate]);
}
