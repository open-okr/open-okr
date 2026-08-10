"use client";

import { Button, Card, CardBody } from "@openokr/ui";
import { TriangleAlert } from "lucide-react";

/**
 * The error state (UIUX-PLAN.md §4: "a surface-level error card with
 * retry, never a blank screen, an error boundary per route segment").
 *
 * A route-level boundary has to be a client component, because it takes a
 * reset callback. It deliberately shows nothing about what went wrong: the
 * message could name a table, a query or a workspace the reader may not know
 * exists. The digest is Next's own correlation id, which is safe to show and
 * is what ties a report here to a line in the server log.
 *
 * Rendered standalone, not inside the app shell: whatever threw may have
 * been the shell's own data fetch (`requireWorkspace` inside
 * `AppShellLayout`), so this cannot assume a sidebar or a workspace exist.
 */
export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4.5">
      <Card className="max-w-sm">
        <CardBody className="flex flex-col items-center gap-3 text-center">
          <TriangleAlert className="size-8 text-bad" aria-hidden="true" />
          <h1 className="text-lg font-bold text-ink">Something went wrong</h1>
          <p className="text-sm text-ink-3">
            We could not load your workspace. This is our fault, not something
            you did.
          </p>
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          {error.digest ? (
            <p className="text-xs text-ink-4">Reference: {error.digest}</p>
          ) : null}
        </CardBody>
      </Card>
    </main>
  );
}
