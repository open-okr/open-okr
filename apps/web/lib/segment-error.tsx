"use client";

import { Button, Card, CardBody, useTranslations } from "@openokr/ui";
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
 * **It draws inside the application shell, since P6-G24b.** It did not at
 * P6-G24a, and that was a limit rather than a choice: thirty-two pages
 * rendered `AppShellLayout` inside themselves, so when a page threw, the shell
 * had never rendered and a boundary below it had no sidebar to keep. The shell
 * is a segment layout now, and Next renders a boundary inside its own
 * segment's layout, so a reader who meets this card still has the navigation
 * and can leave without the browser's back button.
 */
export function SegmentError({
  error,
  reset,
  headingKey,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
  /**
   * The catalogue key of the whole heading, "We could not load the goals".
   * A key rather than the words "the goals" since completeness review M-15:
   * a phrase dropped into another sentence cannot be translated.
   */
  readonly headingKey: string;
}) {
  const { t } = useTranslations();
  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-bad" aria-hidden="true" />
            <h1 className="text-base font-bold text-ink">{t(headingKey)}</h1>
          </span>
          <p className="text-sm text-ink-3">
            {t("segmentError.thisIsOurFault")}
          </p>
          <Button variant="primary" onClick={reset}>
            {t("common.tryAgain")}
          </Button>
          {error.digest ? (
            <p className="text-xs text-ink-4">
              {t("common.reference", { digest: error.digest })}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
