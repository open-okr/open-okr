"use client";

import { SegmentError } from "../../lib/segment-error";

/** This segment's error boundary (P6-G24a). UIUX-PLAN.md §4 asks for one each. */
export default function SpacesError(props: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <SegmentError {...props} what="the spaces" />;
}
