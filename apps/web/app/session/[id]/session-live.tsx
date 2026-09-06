"use client";

/**
 * Thin client wrapper that connects the SSE stream to a router refresh (P4-T07a).
 *
 * The session page is a React Server Component. When a stage changes, all
 * connected clients should see the update without a manual reload. This
 * component subscribes to the SSE endpoint and calls `router.refresh()` on
 * each `session.stageChanged` event, which re-fetches the server component
 * in place — the same mechanism the rest of the app uses for live updates.
 *
 * Acceptance criterion satisfied here: "Given two participants in one
 * session, when the facilitator advances a stage, then both see the new
 * stage without a reload."
 */
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useSessionLive } from "../../../hooks/use-session-live";

interface SessionLiveProps {
  readonly sessionId: string;
}

export function SessionLive({ sessionId }: SessionLiveProps) {
  const router = useRouter();
  const handleUpdate = useCallback(() => {
    router.refresh();
  }, [router]);

  useSessionLive(sessionId, handleUpdate);

  // Renders nothing — pure behaviour.
  return null;
}
