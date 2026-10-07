"use client";

/**
 * Stage seven's second half: the rhythm diagnostic (UIUX-PLAN.md S-24,
 * METHOD.md §8.6, P4-T11c-a).
 *
 * §8.6 calls this the most valuable output of the review. Two numbers in, one
 * verdict and one prescription out: the cycle score over the aspirational key
 * results, and since P9-T20d the rhythm measured from the check-ins that fell
 * due, with process-health statements 2 and 5 beside it as the cross-check.
 * A diagnostic read before then kept the survey's rhythm, and shows it.
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
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { narrateDiagnosticAction, recordDiagnosticAction } from "./actions";

export interface Diagnostic {
  readonly cycleScore: number | null;
  /** §3.4's committed half: the share of committed key results met. */
  readonly committedMet: number | null;
  /** The measured rhythm, and the counts it comes from (P9-T20d). */
  readonly onTimeShare: number | null;
  readonly dueCheckIns: number | null;
  readonly onTimeCheckIns: number | null;
  /** Process-health statements 2 and 5: the cross-check. */
  readonly rhythmScore: number | null;
  readonly verdict: string | null;
  readonly diagnosis: string | null;
  readonly prescription: string | null;
  readonly recorded: boolean;
  readonly readable: boolean;
}

/** A share as a whole percentage, the way §11 states the threshold. */
const percent = (share: number): string => `${Math.round(share * 100)}%`;

const VERDICT_TONE: Record<string, "ok" | "warn" | "bad"> = {
  results_delivered: "ok",
  strategy_or_quality: "warn",
  rhythm: "bad",
};

export function DiagnosticPanel({
  sessionId,
  diagnostic,
  canRead,
  assistAvailable = false,
}: {
  readonly sessionId: string;
  readonly diagnostic: Diagnostic;
  readonly canRead: boolean;
  /**
   * Whether a provider can add the specifics (P4-T15c).
   *
   * False is the normal case and nothing above changes: the verdict, the
   * diagnosis and the prescription are the method's and are on screen either
   * way. This only decides whether a paragraph can be asked for.
   */
  readonly assistAvailable?: boolean;
}) {
  const { t } = useTranslations();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);

  const narrate = useCallback(async () => {
    setNarrating(true);
    setProblem(null);
    try {
      const narrated = await narrateDiagnosticAction(sessionId);
      setNarrative(narrated?.narrative ?? null);
      if (!narrated?.narrative) {
        setProblem("No specifics this time. The verdict above stands.");
      }
    } catch {
      setProblem("The assist could not run. The verdict above is unaffected.");
    } finally {
      setNarrating(false);
    }
  }, [sessionId]);

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
            {t("session.detail.diagnostic.theDiagnostic")}
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
                {t("session.detail.diagnostic.cycleScore")}{" "}
                <span className="font-bold tabular-nums text-ink">
                  {diagnostic.cycleScore?.toFixed(2)}
                </span>
              </span>
              {diagnostic.committedMet === null ? null : (
                <span className="text-xs text-ink-3">
                  {t("session.detail.diagnostic.committedMet", {
                    share: percent(diagnostic.committedMet),
                  })}
                </span>
              )}
              {diagnostic.onTimeShare !== null ? (
                <span className="text-xs text-ink-3">
                  {t("session.detail.diagnostic.onTime", {
                    share: percent(diagnostic.onTimeShare),
                    onTime: String(diagnostic.onTimeCheckIns ?? 0),
                    due: String(diagnostic.dueCheckIns ?? 0),
                  })}
                </span>
              ) : diagnostic.rhythmScore !== null ? (
                // Read before the rhythm was measured: the survey's, as the
                // room was told it.
                <span className="text-xs text-ink-3">
                  {t("session.detail.diagnostic.rhythm")}{" "}
                  <span className="font-bold tabular-nums text-ink">
                    {diagnostic.rhythmScore.toFixed(1)}
                  </span>{" "}
                  {t("common.of5")}
                </span>
              ) : null}
            </p>
            {diagnostic.onTimeShare !== null &&
            diagnostic.rhythmScore !== null ? (
              <p className="text-xs text-ink-4">
                {t("session.detail.diagnostic.surveyCrossCheck", {
                  score: diagnostic.rhythmScore.toFixed(1),
                })}
              </p>
            ) : null}
            <p className="text-xs text-ink-4">
              {t("session.detail.diagnostic.aHypothesis")}
            </p>
            <p className="text-sm font-medium text-ink">
              {diagnostic.prescription}
            </p>
            <p className="text-xs text-ink-4">
              {/* Said on the screen because it is the point of the design: the
                  deterministic path is the product, and AI adds specifics
                  rather than the verdict. */}
              {t("session.detail.diagnostic.computedFromYourOwn")}
            </p>
            {narrative ? (
              <section
                aria-label={t("session.detail.diagnostic.diagnosticSpecifics")}
                className="rounded-md border border-line bg-surface p-3"
              >
                <span className="mb-1.5 flex items-center gap-2">
                  <Chip tone="agent">{t("common.ai")}</Chip>
                  <span className="text-xs text-ink-4">
                    {t("session.detail.diagnostic.specificsUnderTheVerdict")}
                  </span>
                </span>
                <p className="text-sm text-ink">{narrative}</p>
              </section>
            ) : null}
            {assistAvailable && narrative === null ? (
              <span>
                <Button
                  type="button"
                  size="sm"
                  variant="ai"
                  disabled={narrating}
                  onClick={() => void narrate()}
                >
                  {t("session.detail.diagnostic.addTheSpecifics")}
                </Button>
              </span>
            ) : null}
          </>
        ) : diagnostic.readable ? (
          <>
            <p className="text-sm text-ink-2">
              {diagnostic.onTimeShare === null
                ? t("session.detail.diagnostic.deliveredReady", {
                    cycleScore: diagnostic.cycleScore?.toFixed(2) ?? "",
                  })
                : t("session.detail.diagnostic.numbersReady", {
                    cycleScore: diagnostic.cycleScore?.toFixed(2) ?? "",
                    share: percent(diagnostic.onTimeShare),
                  })}
            </p>
            {canRead ? (
              <span>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={read}
                >
                  {t("session.detail.diagnostic.readTheDiagnostic")}
                </Button>
              </span>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-3">
            {/* Two missing numbers, one sentence: §8.6 combines both and a
                diagnostic built on a missing answer reads as evidence. */}
            {t("session.detail.diagnostic.theDiagnosticNeedsA")}
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
              {t("session.detail.diagnostic.readItAgain")}
            </Button>
          </span>
        ) : null}
      </CardBody>
    </Card>
  );
}
