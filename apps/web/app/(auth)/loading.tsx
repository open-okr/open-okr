import { CentredLoading } from "../../lib/segment-loading.tsx";

/**
 * The authentication screens' loading state (P8-G01).
 *
 * One file covers all five: Next resolves `loading.tsx` to the nearest
 * ancestor directory, and a route group is a directory. Sign-in, sign-up,
 * both password screens and the backup code are the same single card, so
 * they want the same fallback rather than five copies of it.
 */
export default function Loading() {
  return <CentredLoading />;
}
