"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Re-reads the agents screen as its runs move (PLAN.md §7, release 0.7.0 A11).
 *
 * **`router.refresh()`, and no row drawn in the browser**, for the reason the
 * feed, the inbox and the board each reached: the event carries a run's id
 * and version and nothing a row could be drawn from, so the server render
 * stays the only writer of the run list, and the proposal queue above it
 * moves with it when a step proposes something.
 *
 * **The version is what lets it skip.** The page passes the version of every
 * run it rendered. An event at or below that is news the reader already has:
 * the echo of the button they just pressed, whose action refreshed the page
 * itself, or a delivery repeated by the outbox. A run the page has not shown
 * yet, or an event it cannot read, re-reads, because a missed change is worse
 * than a spare request.
 *
 * **Coalesced**, because a custom agent's run takes its steps back to back and
 * each is an event. A trailing window turns a burst into one re-read.
 */
const WINDOW_MS = 1_000;

function readEvent(data: unknown): { runId: string; version: number } | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "runId" in parsed &&
      "version" in parsed &&
      typeof parsed.runId === "string" &&
      typeof parsed.version === "number"
    ) {
      return { runId: parsed.runId, version: parsed.version };
    }
  } catch {
    // Unreadable, so treated as news below.
  }
  return null;
}

export function AgentRunsLive({
  versions,
}: {
  /** Each rendered run's version, by run id. */
  readonly versions: Readonly<Record<string, number>>;
}) {
  const router = useRouter();
  const shown = useRef(versions);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The latest render is what an event is compared against, without
  // reopening the stream every time the page refreshes.
  useEffect(() => {
    shown.current = versions;
  }, [versions]);

  useEffect(() => {
    const source = new EventSource("/api/agents/live");

    const onChanged = (event: MessageEvent) => {
      const change = readEvent(event.data);
      const rendered =
        change === null ? undefined : shown.current[change.runId];
      if (
        change !== null &&
        rendered !== undefined &&
        change.version <= rendered
      ) {
        return;
      }
      if (pending.current) {
        return;
      }
      pending.current = setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, WINDOW_MS);
    };

    source.addEventListener("agentRun.changed", onChanged);
    return () => {
      source.removeEventListener("agentRun.changed", onChanged);
      source.close();
      if (pending.current) {
        clearTimeout(pending.current);
        pending.current = null;
      }
    };
  }, [router]);

  return null;
}
