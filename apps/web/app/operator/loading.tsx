import { CentredLoading } from "../../lib/segment-loading.tsx";

/**
 * The operator console's loading state (P8-G01).
 *
 * **Changed from `SegmentLoading` at P8-G01.** It was given the in-shell
 * two-card skeleton at 6146e82, which was the shape every other segment
 * used, and `app/operator` has no layout and never calls
 * `AppShellLayout`: the fallback drew full width at the top of an empty
 * page and resolved into a centred reading column.
 */
export default function Loading() {
  return <CentredLoading width="wide" />;
}
