"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import { launchRecovery } from "./actions.ts";

/**
 * One click, because there is nothing to fill in: the objective and its key
 * results are computed from the driver tree (METHOD.md §6.5). The refusal is
 * shown where the button is, so a workspace with no open cycle reads why
 * instead of nothing happening.
 */
export function LaunchRecovery({
  kpiId,
  size = "default",
}: {
  readonly kpiId: string;
  /**
   * Small in a tree row, the size of the page's other buttons such as New
   * tree; the default size stood taller than the row and wrapped.
   */
  readonly size?: "default" | "sm";
}) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const launch = () =>
    start(async () => {
      const result = await launchRecovery(kpiId);
      setError(result.error);
    });
  const label = pending
    ? t("kpis.recovery.launch.launching")
    : t("kpis.recovery.launch.launchRecovery");

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="primary"
        size={size}
        pending={pending}
        onClick={launch}
      >
        {label}
      </Button>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
