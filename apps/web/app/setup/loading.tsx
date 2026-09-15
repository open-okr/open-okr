import { CentredLoading } from "../../lib/segment-loading.tsx";

/**
 * The first-run wizard's loading state (P8-G01).
 *
 * Covers `setup/account` too. This is the screen a fresh deployment answers
 * with, so it is the one where a blank pause is most likely to be read as a
 * broken install rather than as a slow one.
 */
export default function Loading() {
  return <CentredLoading />;
}
