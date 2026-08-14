"use client";

import { Button } from "@openokr/ui";
import { useState, useTransition } from "react";
import { launchRecovery } from "./actions.ts";

/**
 * One click, because there is nothing to fill in: the objective and its key
 * results are computed from the driver tree (METHOD.md §6.5). The refusal is
 * shown where the button is, so a workspace with no open cycle reads why
 * instead of nothing happening.
 */
export function LaunchRecovery({ kpiId }: { readonly kpiId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await launchRecovery(kpiId);
            setError(result.error);
          })
        }
      >
        {pending ? "Launching" : "Launch recovery"}
      </Button>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
