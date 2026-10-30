"use client";

import { SegmentError } from "../../lib/segment-error";

/**
 * The company map's own error boundary, inside the shell like every other
 * segment's (P6-G24b). The same heading as Home's, because it is the same
 * tree (OKRGoal UX review, backlog 12).
 */
export default function MapError(props: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <SegmentError {...props} headingKey="segmentError.home" />;
}
