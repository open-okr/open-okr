"use client";

import { SegmentError } from "../../lib/segment-error";

/**
 * The Work Map's own error boundary (P6-G24a, moved here at P6-G24b).
 *
 * The front door used to fall back to `app/error.tsx`, which is outside the
 * shell by design: it is the boundary for the root layout's own failures. So a
 * failed read on the busiest screen in the product replaced the sidebar and
 * the navigation along with the panel that failed. Inside the group, this one
 * renders within the shell like every other segment's.
 */
export default function HomeError(props: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <SegmentError {...props} what="your Work Map" />;
}
