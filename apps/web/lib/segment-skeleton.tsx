import { Card, CardBody, CardHeader } from "@openokr/ui";

/**
 * What a route shows while its reads are in flight (P6-G24a).
 *
 * **Nothing showed anything before this.** Every page in this application is an
 * async server component that awaits several reads before returning, and there
 * was not one `loading.tsx` or `Suspense` boundary anywhere: a navigation left
 * the previous page on screen with no indication that anything was happening,
 * and on a slow read that reads as a dead click. UIUX-PLAN.md §9's first
 * checked item is "loading, empty, error and permission-denied states
 * implemented" and loading was the one covered nowhere. The gap audit of
 * 7 September 2026 recorded it as G-06.
 *
 * **It is announced, not just drawn.** `role="status"` with a real label is
 * what tells somebody using a screen reader that the page is loading; a pulsing
 * grey rectangle tells them nothing at all. `aria-busy` on the region is what
 * their software reads to stop announcing the stale content above it.
 *
 * **The pulse needs no reduced-motion guard of its own.** `globals.css`
 * neutralises every animation under `prefers-reduced-motion: reduce` with an
 * `!important` override, and nothing here is gated on the animation: the
 * skeleton is the same shape whether it moves or not.
 */
/**
 * The row widths, which double as the keys.
 *
 * Varied rather than identical because a column of equal bars reads as a
 * table and a page of text does not, and because the width is a stable
 * identity: `key={index}` on a placeholder is what `noArrayIndexKey` refuses,
 * and it is right to, even here where nothing reorders.
 */
const ROWS = [
  "w-full",
  "w-11/12",
  "w-10/12",
  "w-9/12",
  "w-8/12",
  "w-7/12",
  "w-6/12",
  "w-5/12",
] as const;

export function SegmentSkeleton({
  what,
  rows = 4,
}: {
  /** The screen being loaded, for the announcement. "Goals", "This cycle". */
  readonly what: string;
  readonly rows?: number;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col gap-4.5"
    >
      <span className="sr-only">Loading {what}</span>
      <Card>
        <CardHeader>
          <div className="h-5 w-40 animate-pulse rounded-md bg-raised" />
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          {ROWS.slice(0, Math.min(rows, ROWS.length)).map((width) => (
            <div
              key={width}
              className="flex items-center justify-between gap-3"
            >
              <div
                className={`h-4 animate-pulse rounded-md bg-raised ${width}`}
              />
              <div className="h-4 w-16 flex-none animate-pulse rounded-md bg-raised" />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
