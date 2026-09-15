import { CentredLoading } from "../../lib/segment-loading.tsx";

/**
 * Onboarding's loading state (P8-G01).
 *
 * `welcome` inherits the root error boundary on purpose (P6-G26: a reader
 * here has no navigation to keep). That decision is about where a failure
 * draws and says nothing about whether a wait should be visible, which is
 * the split P8-G01 made.
 */
export default function Loading() {
  return <CentredLoading />;
}
