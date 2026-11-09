"use client";

import { SegmentError } from "../../lib/segment-error";

/**
 * This segment's error boundary (P6-G24a). A key result's short link lands on
 * its goal's page (plan 0.7.0 D1), so a failure here is the goal's to name.
 */
export default function KeyResultsError(props: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <SegmentError {...props} headingKey="segmentError.goals" />;
}
