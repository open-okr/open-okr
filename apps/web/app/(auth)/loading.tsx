/**
 * A standalone screen, loading (P6-G24a).
 *
 * Its own rather than the root skeleton, which is shell-shaped: these screens
 * are a single centred card and flashing a sidebar in front of one would be the
 * wrong layout twice.
 */
export default function StandaloneLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-48 items-center justify-center"
    >
      <span className="sr-only">Loading</span>
      <div className="h-24 w-full max-w-sm animate-pulse rounded-lg bg-raised" />
    </div>
  );
}
