import { SegmentSkeleton } from "../lib/segment-skeleton";

/**
 * The work map, loading (P6-G24a).
 *
 * At the root, so it is also the fallback for any segment that grows without a
 * `loading.tsx` of its own. `(auth)` and `setup` have theirs, because a
 * shell-shaped skeleton in front of a centred sign-in card would flash the
 * wrong layout.
 */
export default function HomeLoading() {
  return <SegmentSkeleton what="your work map" rows={6} />;
}
