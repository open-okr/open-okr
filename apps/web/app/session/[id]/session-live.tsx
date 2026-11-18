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
import { useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionLive } from "../../../hooks/use-session-live";

interface SessionLiveProps {
  readonly sessionId: string;
  /** The stage the session is on now, as the server rendered it. */
  readonly stageKey: string | null;
  /** The ritual's stages in order, so the announcement can name and count. */
  readonly stages: readonly { readonly key: string; readonly title: string }[];
}

export function SessionLive({ sessionId, stageKey, stages }: SessionLiveProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const handleUpdate = useCallback(() => {
    router.refresh();
  }, [router]);

  useSessionLive(sessionId, handleUpdate);

  // A stage change reached this page as a refreshed prop, which a screen
  // reader never hears on its own. The region starts empty and is written only
  // when the stage differs from the one already shown, so the first render and
  // a refresh that changes nothing (the participant's own action) stay silent.
  // Focus is left where it is.
  const previous = useRef(stageKey);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (previous.current === stageKey) return;
    previous.current = stageKey;
    const index = stages.findIndex((stage) => stage.key === stageKey);
    if (index < 0) return;
    setAnnouncement(
      t("session.detail.stageAnnounced", {
        step: index + 1,
        total: stages.length,
        name: stages[index]?.title ?? "",
      }),
    );
  }, [stageKey, stages, t]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
