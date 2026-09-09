"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Re-reads a feed when the workspace's feed moves (S-31, P6-G11c).
 *
 * **`router.refresh()`, and no row drawn in the browser.** That is the
 * deduplication answer, the same one the inbox reached at P6-G07c and the
 * board at P5-T11: the event carries nothing at all, so the client could not
 * draw a row from it, and the server render stays the only writer of the list.
 * There is nothing to match against what the next navigation loads because
 * nothing but the server ever writes a row.
 *
 * **Coalesced, because one channel serves every scope.** The route forwards
 * every workspace event that this member did not cause, and on a busy
 * workspace that is a burst. Refreshing per event would re-render the page
 * tens of times for one import or one session. A trailing window collapses a
 * burst into one re-read, which is what the reader would have got from a
 * single refresh anyway.
 *
 * **Silent.** Unlike the inbox, this panel says nothing when rows arrive. A
 * feed is a record the reader is browsing rather than a queue they are
 * working, and rows land at the top where they are visible on their own.
 */
const WINDOW_MS = 1_500;

export function FeedLive({
  scope,
  subjectId,
}: {
  readonly scope: "workspace" | "space" | "goal" | "profile";
  /** Absent only for the workspace scope, which has no subject. */
  readonly subjectId?: string;
}) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ scope });
    if (subjectId) {
      query.set("id", subjectId);
    }
    const source = new EventSource(`/api/feed/live?${query.toString()}`);

    const onChanged = () => {
      if (pending.current) {
        return;
      }
      pending.current = setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, WINDOW_MS);
    };

    source.addEventListener("feed.changed", onChanged);
    return () => {
      source.removeEventListener("feed.changed", onChanged);
      source.close();
      if (pending.current) {
        clearTimeout(pending.current);
        pending.current = null;
      }
    };
  }, [scope, subjectId, router]);

  return null;
}
