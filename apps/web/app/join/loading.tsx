import { CentredLoading } from "../../lib/segment-loading.tsx";

/**
 * The invitation screen's loading state (P8-G01).
 *
 * A visitor following an invitation has no membership anywhere yet, so this
 * is drawn outside the shell like the authentication screens and takes the
 * same centred card.
 */
export default function Loading() {
  return <CentredLoading />;
}
