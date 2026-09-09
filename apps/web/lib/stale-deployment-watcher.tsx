"use client";

import { useStaleDeployment, useTranslations } from "@openokr/ui";
import { useCallback } from "react";

/**
 * The client half of the stale-tab reload (P2-T10 item 9). Polls the
 * authenticated `/api/app-version` endpoint; `use-stale-deployment.ts`
 * owns the actual once-only reload guard.
 *
 * **It says so, which it did not until P6-G22c.** UIUX-PLAN §3 asks for "one
 * reload with a clear message" and the message was written into the catalogue
 * at P2-T10 as `shell.version.updateAvailable`. Nothing ever rendered it: the
 * hook has returned `stale` since it was built and this component threw it
 * away and returned null. P6-G22c's new assertion that every catalogue key has
 * a consumer is what found it, which is the argument for that assertion.
 *
 * A live region rather than a dialogue, because the reload is already under
 * way and there is nothing to decide. It is on screen for the moment between
 * the mismatch being seen and the page going.
 */
export function StaleDeploymentWatcher({
  buildId,
}: {
  readonly buildId: string;
}) {
  const fetchLiveBuildId = useCallback(async () => {
    const response = await fetch("/api/app-version", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`app-version responded ${response.status}`);
    }
    const data: { buildId: string } = await response.json();
    return data.buildId;
  }, []);

  const { t } = useTranslations();
  const { stale } = useStaleDeployment({
    embeddedBuildId: buildId,
    fetchLiveBuildId,
  });

  if (!stale) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="stale-deployment"
      className="fixed inset-x-0 bottom-0 z-50 bg-raised px-3 py-2 text-center text-sm text-ink"
    >
      {t("shell.version.updateAvailable")}
    </div>
  );
}
