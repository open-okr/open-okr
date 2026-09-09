"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Re-reads the inbox when a row lands (UIUX-PLAN §4 S-03, P6-G07c).
 *
 * **`router.refresh()`, not a row appended in the browser.** That is the whole
 * deduplication answer, and it is deliberate rather than lazy: the event
 * carries identifiers only, so the client could not draw a row from it without
 * a second fetch, and a row it drew itself would then have to be matched
 * against the one the next server render returns. Refreshing makes the server
 * render the only writer of this list, so there is nothing to deduplicate. The
 * board reached the same conclusion at P5-T11.
 *
 * **A count, not a silent swap.** A list that rearranges under a reader who is
 * mid-sentence is worse than one that says how many arrived and waits. The
 * refresh runs immediately, because the rows group by subject and a new row
 * usually joins a group rather than displacing one; the line exists so the
 * reader can tell the list moved and why.
 */
export function InboxLive() {
  const router = useRouter();
  const [arrived, setArrived] = useState(0);

  useEffect(() => {
    const source = new EventSource("/api/inbox/live");
    const onAdded = () => {
      setArrived((count) => count + 1);
      router.refresh();
    };
    source.addEventListener("inbox.added", onAdded);
    return () => {
      source.removeEventListener("inbox.added", onAdded);
      source.close();
    };
  }, [router]);

  if (arrived === 0) {
    return null;
  }

  return (
    <p className="text-xs text-ink-3" role="status" data-testid="inbox-live">
      {arrived === 1
        ? "1 row arrived while you were here."
        : `${arrived} rows arrived while you were here.`}
    </p>
  );
}
