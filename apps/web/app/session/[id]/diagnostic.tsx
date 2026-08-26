"use client";

/**
 * Stage seven's second half: the rhythm diagnostic (UIUX-PLAN.md S-24,
 * METHOD.md §8.6, P4-T11c-a).
 *
 * §8.6 calls this the most valuable output of the review. Two numbers in, one
 * verdict and one prescription out.
 *
 * **Every word of it comes from `packages/method`.** The verdict, the diagnosis
 * and the prescription are `rhythmDiagnostic`'s, and the two thresholds it reads
 * are §11 parameters. This component chooses a colour and nothing else, which is
 * why it says so on the screen: the same answer arrives with the AI provider off.
 *
 * **Reading it is a write.** The verdict is stored with the numbers it was read
 * against, because the minutes have to show what the room was told and a
 * diagnostic recomputed later would quietly change its verdict as scores were
 * corrected.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { recordDiagnosticAction } from "./actions";

export interface Diagnostic {
  readonly cycleScore: number | null;
  readonly rhythmScore: number | null;
  readonly verdict: string | null;
  readonly diagnosis: string | null;
  readonly prescription: string | null;
  readonly recorded: boolean;
  readonly readable: boolean;
}

const VERDICT_TONE: Record<string, "ok" | "warn" | "bad"> = {
  results_delivered: "ok",
  strategy_or_quality: "warn",
  rhythm: "bad",
};

export function DiagnosticPanel({
  sessionId,
  diagnostic,
  canRead,
}: {
  readonly sessionId: string;
  readonly diagnostic: Diagnostic;
  readonly canRead: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const read = useCallback(() => {
    setProblem(null);
    startTransition(async () => {
      try {
        await recordDiagnosticAction(sessionId);
        router.refresh();
      } catch (error) {
        setProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [router, sessionId]);

  return (
    <Card role="region" aria-labelledby="diagnostic-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="diagnostic-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            The diagnostic
          </h2>
          {diagnostic.verdict === null ? null : (
            <Chip tone={VERDICT_TONE[diagnostic.verdict] ?? "neutral"}>
              {diagnostic.diagnosis}
            </Chip>
          )}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {diagnostic.recorded ? (
          <>
            <p className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-ink-3">
                Cycle score{" "}
                <span className="font-bold tabular-nums text-ink">
                  {diagnostic.cycleScore?.toFixed(2)}
                </span>
              </span>
              <span className="text-xs text-ink-3">
                Rhythm{" "}
                <span className="font-bold tabular-nums text-ink">
                  {diagnostic.rhythmScore?.toFixed(1)}
                </span>{" "}
                of 5
              </span>
            </p>
            <p className="text-sm font-medium text-ink">
              {diagnostic.prescription}
            </p>
            <p className="text-xs text-ink-4">
              {/* Said on the screen because it is the point of the design: the
                  deterministic path is the product, and AI adds specifics
                  rather than the verdict. */}
              Computed from your own data. It is the same answer with AI
              switched off.
            </p>
          </>
        ) : diagnostic.readable ? (
          <>
            <p className="text-sm text-ink-2">
              Both numbers are in: a cycle score of{" "}
              {diagnostic.cycleScore?.toFixed(2)} and a rhythm of{" "}
              {diagnostic.rhythmScore?.toFixed(1)} of 5.
            </p>
            {canRead ? (
              <span>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={read}
                >
                  Read the diagnostic
                </Button>
              </span>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-3">
            {/* Two missing numbers, one sentence: §8.6 combines both and a
                diagnostic built on a missing answer reads as evidence. */}
            The diagnostic needs a cycle score and a rhythm score. Grade the key
            results, then run the process-health survey.
          </p>
        )}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        {diagnostic.recorded && canRead ? (
          <span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={read}
            >
              Read it again
            </Button>
          </span>
        ) : null}
      </CardBody>
    </Card>
  );
}
