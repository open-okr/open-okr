"use client";

import { useStaleDeployment } from "@openokr/ui";
import { useCallback } from "react";

/**
 * The client half of the stale-tab reload (P2-T10 item 9). Polls the
 * authenticated `/api/app-version` endpoint; `use-stale-deployment.ts`
 * owns the actual once-only reload guard.
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

  useStaleDeployment({ embeddedBuildId: buildId, fetchLiveBuildId });

  return null;
}
