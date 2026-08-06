/**
 * The loading state for the workspace panel.
 *
 * A placeholder with the same shape as the content it stands in for, so the
 * page does not jump when the data arrives. `aria-busy` and the status role
 * tell a screen reader that something is on its way rather than leaving it to
 * announce nothing at all.
 *
 * Unstyled, like the rest of this route. P2-T10 brings the design system.
 */
export function OverviewSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <p>Loading your workspace…</p>
    </div>
  );
}
