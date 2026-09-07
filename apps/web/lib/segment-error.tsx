"use client";

import { Button, Card, CardBody } from "@openokr/ui";
import { TriangleAlert } from "lucide-react";

/**
 * One route segment's error boundary (P6-G24a).
 *
 * **UIUX-PLAN.md §4 asks for "an error boundary per route segment" and there
 * was exactly one, at the root.** So a failed read anywhere replaced the whole
 * application with a full-screen card, and a reader could not tell a broken
 * KPI page from a broken instance. The gap audit of 7 September 2026 recorded
 * it as G-07.
 *
 * **It names the screen and nothing else about the failure.** The message
 * could name a table, a query or a workspace the reader may not know exists,
 * which is the same reason the root boundary withholds it. The digest is Next's
 * own correlation id: safe to show, and the only thing that ties a report here
 * to a line in the server log.
 *
 * **It does not draw the application shell, and that is a limit rather than a
 * choice.** Thirty-one pages render `AppShellLayout` inside themselves rather
 * than through a `layout.tsx`, so when a page throws the shell never rendered
 * and a boundary below it has no sidebar to keep. Moving the shell into
 * per-segment layouts is P6-G24b, and after that this card sits inside it.
 */
export function SegmentError({
  error,
  reset,
  what,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
  /** The screen that failed, in words. "the goals", "this cycle". */
  readonly what: string;
}) {
  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-bad" aria-hidden="true" />
            <h1 className="text-base font-bold text-ink">
              We could not load {what}
            </h1>
          </span>
          <p className="text-sm text-ink-3">
            This is our fault, not something you did. Nothing was changed.
          </p>
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          {error.digest ? (
            <p className="text-xs text-ink-4">Reference: {error.digest}</p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
