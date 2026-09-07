import { SegmentSkeleton } from "../../lib/segment-skeleton";

/** What this segment shows while its reads are in flight (P6-G24a). */
export default function ActivityLoading() {
  return <SegmentSkeleton what="Activity" rows={8} />;
}
