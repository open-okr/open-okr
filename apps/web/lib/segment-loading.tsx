import { Card, CardBody } from "@openokr/ui";

/**
 * One route segment's loading state (UIUX-PLAN §4, P6-G24c).
 *
 * **This shipped at P6-G24a and came straight back out.** Twenty-two
 * `loading.tsx` files took the end-to-end suite from 184 passing to 75, and
 * the first failure was two copies of the same chip in the DOM at once. The
 * row was split so that could be explained rather than worked around.
 *
 * **The explanation, from a trace.** A `loading.tsx` makes Next stream the
 * segment behind a Suspense boundary, and React resolves an out-of-order
 * boundary by putting the finished subtree in `<div hidden id="S:0">` at the
 * end of the body, then running an inline script that moves it into place.
 * Between those two steps the document holds the content twice, and
 * Playwright's strict mode counts every match including the hidden one. It is
 * not a defect: nobody ever sees the staged copy. `e2e/fixtures.ts` waits for
 * the staging element to go before a spec asserts anything, which is why these
 * can exist now.
 *
 * **P6-G24b had to come first.** With the shell inside each page rather than
 * in a layout, the fallback rendered with no shell at all and the resolved
 * content arrived carrying its own, so the swap replaced the whole application
 * frame. Now the fallback renders inside the shell and only the panel changes.
 *
 * **A skeleton with no text.** A spinner says "wait"; a skeleton says "wait,
 * and here is the shape of what is coming". No copy, because a loading state
 * is the one screen a reader should never have to read, and because a string
 * here would be a string outside the catalogue (P6-G22b).
 */
export function SegmentLoading({
  rows = 3,
}: {
  /** How many placeholder rows the shape of this screen wants. */
  readonly rows?: number;
}) {
  // Named before the render rather than keyed by the loop index, which the
  // lint refuses: a placeholder has no data behind it to key on, and this is
  // the shortest way to say so that the rule accepts.
  const placeholders = Array.from(
    { length: rows },
    (_, index) => `row-${index}`,
  );

  return (
    <div
      className="flex flex-col gap-4.5"
      aria-busy="true"
      aria-live="polite"
      data-testid="segment-loading"
    >
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="h-5 w-48 animate-pulse rounded bg-raised" />
          <div className="h-3 w-72 animate-pulse rounded bg-raised" />
        </CardBody>
      </Card>
      <Card>
        <CardBody className="flex flex-col gap-2.5">
          {placeholders.map((key) => (
            <div key={key} className="h-9 animate-pulse rounded bg-raised" />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
