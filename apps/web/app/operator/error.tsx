"use client";

import { SegmentError } from "../../lib/segment-error";

/**
 * This segment's error boundary (P6-G24a). UIUX-PLAN.md §4 asks for one each.
 *
 * **Added at P8-T04b-fix, because `segment-boundaries.test.ts` was already
 * red.** The operator screens landed at P8-T03b with no boundary of their
 * own, so a failed tenant read fell all the way to `app/error.tsx` and
 * replaced the page with the card that is meant for a broken instance. The
 * test that exists to catch exactly that had been failing on `agung` ever
 * since, and no continuous integration run had seen it: those commits are
 * not pushed.
 *
 * **It draws bare, and that is a fact about this segment rather than a
 * choice made here.** `app/operator` has no layout and never renders
 * `AppShellLayout`, so unlike the in-shell segments there is no sidebar for
 * this card to sit beside. `reset()` is still worth having: it retries the
 * operator read alone instead of the whole document.
 */
export default function OperatorError(props: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <SegmentError {...props} what="the operator console" />;
}
