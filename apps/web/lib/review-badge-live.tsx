"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Keeps the sidebar's Review count live (completeness review M-32).
 *
 * TECHNICAL-PLAN makes the review inbox live; the badge beside it was
 * recomputed only on navigation. Every write that changes somebody's review
 * obligations also writes an activity, and every activity moves the
 * workspace's feed stream, so this listens there, waits for a burst to settle,
 * asks the server for the count alone, and refreshes the page only when that
 * number actually moved. A busy workspace costs one small read per burst, not
 * a re-render of every open page.
 */
const WINDOW_MS = 1_500;

export function ReviewBadgeLive({ count }: { readonly count: number | null }) {
  const router = useRouter();
  const shown = useRef(count);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shown.current = count;
  }, [count]);

  useEffect(() => {
    const source = new EventSource("/api/feed/live?scope=workspace");
    const onChanged = () => {
      if (pending.current) {
        return;
      }
      pending.current = setTimeout(async () => {
        pending.current = null;
        try {
          const response = await fetch("/api/review/badge", {
            cache: "no-store",
          });
          if (!response.ok) {
            return;
          }
          const { count: next } = (await response.json()) as {
            count: number | null;
          };
          if (next !== shown.current) {
            shown.current = next;
            router.refresh();
          }
        } catch {
          // A dropped read leaves the badge as it was until the next change or
          // navigation, which is exactly what it did before this existed.
        }
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
  }, [router]);

  return null;
}
