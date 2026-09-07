"use client";

import { SegmentError } from "../../lib/segment-error";

/** This segment error boundary (P6-G24a). UIUX-PLAN.md §4 asks for one each. */
export default function ActivityError(props: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <SegmentError {...props} what="the activity feed" />;
}
