import { Card, CardBody, CardHeader } from "@openokr/ui";

/**
 * The loading state for the workspace panel (UIUX-PLAN.md §4: "Loading:
 * skeletons matching the final layout").
 *
 * A placeholder with the same shape as the content it stands in for, so the
 * page does not jump when the data arrives. `aria-busy` and the status role
 * tell a screen reader that something is on its way rather than leaving it to
 * announce nothing at all.
 */
export function OverviewSkeleton() {
  return (
    <Card aria-busy="true" role="status">
      <CardHeader>
        <span className="sr-only">Loading your workspace…</span>
        <div className="h-4.5 w-56 animate-pulse rounded bg-raised" />
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="h-4 w-full animate-pulse rounded bg-raised"
          />
        ))}
      </CardBody>
    </Card>
  );
}
