"use client";

/**
 * Running an agent by hand (P4-T05c-b).
 *
 * **Why a button exists at all.** `registerAgentSchedules` declares four crons
 * and this repository has no worker process to execute them, which four files
 * already record. Until one exists, an administrator asking for a run is the
 * only way an agent ever speaks, and a screen that listed runs without being
 * able to cause one would describe a product nobody could use.
 *
 * The label says which clock, not "run": an administrator choosing between the
 * daily sweep and the cycle countdown is choosing what the agent will look at,
 * and "Run" would hide that.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { runChampionAction, runCoachAction } from "./actions";

type Cadence = "hourly" | "daily" | "weekly" | "cycle";

const CHAMPION_RUNS: readonly { cadence: Cadence; label: string }[] = [
  { cadence: "hourly", label: "Nudge queue" },
  { cadence: "daily", label: "Daily sweep" },
  { cadence: "weekly", label: "Session lifecycle" },
  { cadence: "cycle", label: "Cycle countdown" },
];

export function RunControls({ drafting }: { drafting: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const run = useCallback(
    (task: () => Promise<void>) => {
      setProblem(null);
      startTransition(async () => {
        try {
          await task();
          router.refresh();
        } catch (error) {
          // Named rather than swallowed. A run that failed silently would
          // leave an administrator watching a list that never changes.
          setProblem(
            error instanceof Error ? error.message : "The run did not finish.",
          );
        }
      });
    },
    [router],
  );

  return (
    <Card>
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-ink">Run one now</h2>
          {drafting ? (
            <Chip tone="agent">Drafting on</Chip>
          ) : (
            <Chip tone="neutral">Deterministic only</Chip>
          )}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          {drafting
            ? "A provider is configured, so a run may also draft check-ins and recovery titles. Everything it drafts is a proposal somebody applies."
            : "No AI provider is configured. Every trigger, ladder and corridor still fires; nothing is drafted."}
        </p>

        <span className="flex flex-wrap gap-2">
          {CHAMPION_RUNS.map((entry) => (
            <Button
              key={entry.cadence}
              type="button"
              variant="default"
              disabled={pending}
              onClick={() => run(() => runChampionAction(entry.cadence))}
            >
              {entry.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="default"
            disabled={pending}
            onClick={() => run(() => runCoachAction())}
          >
            Quality pass
          </Button>
        </span>

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}
      </CardBody>
    </Card>
  );
}
