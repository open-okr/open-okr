"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { openedAt, recordRecent } from "../../lib/recent-store.ts";

/**
 * Records what is opened, for the palette's Recent group (work-layer.md §5.1,
 * G2-D1 and G2-D2). Draws nothing.
 *
 * **One place, not one per page.** It sits in the shell beside the palette and
 * reads the address, so the six pages with an identity of their own and the
 * objective drawer (`?okr=`, `&kr=`) are all covered by the one rule that says
 * what an address means, and a seventh page is a line in `openedAt`.
 */
export function RecentRecorder({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  // The string, not the object: `useSearchParams` hands back a new one on
  // every render, and an effect keyed on it would record the same open again.
  const search = params.toString();

  useEffect(() => {
    for (const one of openedAt(pathname, new URLSearchParams(search))) {
      recordRecent(workspaceId, one.kind, one.id);
    }
  }, [pathname, search, workspaceId]);

  return null;
}
