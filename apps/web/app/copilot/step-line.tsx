"use client";

/**
 * What the copilot is doing while it works, and what it did once it started
 * writing (plan 0.8.1 CP9, review §3.2 and F27).
 *
 * **One line, replaced in place, never stacked.** Searching, then what it
 * found, then checking whether the question is a change it can make, then
 * writing. Each step stays at least `STEP_DWELL_MS`, so a step that took ten
 * milliseconds is still read rather than flickering past.
 *
 * **It folds once words arrive.** The answer is what the reader came for, so
 * the steps become one quiet line above it, a disclosure listing each with a
 * check, closed by default. Live only: the run's steps are not stored (plan
 * 0.8.1 W2-Q), so after a reload the sources and the card say the same, and
 * the count of reads comes back as `ReadCountLine` (plan 0.9.0 L3).
 *
 * **Motion.** A slow shimmer across the working line while motion is allowed;
 * under reduced motion it is plain text (UIUX-PLAN §2).
 */
import { useTranslations } from "@openokr/ui";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Step, stepWords } from "./turn";

/** The shortest time a step is on screen, in milliseconds. */
const STEP_DWELL_MS = 400;

/**
 * Which step to show next, given the one shown and how long it has been.
 *
 * Pure, so the dwell is tested without a clock: the line moves on one step
 * at a time, and only once the shown step has had its dwell.
 */
export function nextShownStep(
  count: number,
  shown: number,
  shownForMs: number,
  dwellMs = STEP_DWELL_MS,
): number {
  if (count === 0) {
    return -1;
  }
  if (shown < 0) {
    return 0;
  }
  if (shown < count - 1 && shownForMs >= dwellMs) {
    return shown + 1;
  }
  return Math.min(shown, count - 1);
}

/** The step on screen, moved on no faster than the dwell allows. */
function useSteadyStep(steps: readonly Step[]): Step | null {
  const [shown, setShown] = useState(-1);
  const since = useRef(0);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-runs this once a dwell has passed.
  useEffect(() => {
    const now = Date.now();
    const next = nextShownStep(steps.length, shown, now - since.current);
    if (next !== shown) {
      since.current = now;
      setShown(next);
      return;
    }
    if (shown >= 0 && shown < steps.length - 1) {
      const wait = Math.max(0, STEP_DWELL_MS - (now - since.current));
      const timer = setTimeout(() => setTick((was) => was + 1), wait);
      return () => clearTimeout(timer);
    }
  }, [steps.length, shown, tick]);

  return shown >= 0 ? (steps[shown] ?? null) : null;
}

/** The working line: the current step, shimmering where motion is allowed. */
export function StepLine({ steps }: { readonly steps: readonly Step[] }) {
  const { t } = useTranslations();
  const step = useSteadyStep(steps);
  if (!step) {
    return null;
  }
  return (
    <p className="copilot-shimmer text-sm text-ink-3">
      {t("copilot.copilotPanel.step.working", { step: stepWords(step, t) })}
    </p>
  );
}

/**
 * The same quiet line after a reload, when the steps are gone and only the
 * count of reads is left (plan 0.9.0 L3, W2-Q): the count is rebuilt from the
 * record of the copilot's reads, so the line says what it did without listing
 * each read.
 */
export function ReadCountLine({ count }: { readonly count: number }) {
  const { t } = useTranslations();
  if (count <= 0) {
    return null;
  }
  return (
    <p className="text-xs text-ink-3">
      {count === 1
        ? t("copilot.copilotPanel.step.summaryReadOne", { count })
        : t("copilot.copilotPanel.step.summaryReadOther", { count })}
    </p>
  );
}

/**
 * The steps, folded into one quiet line once the answer has started:
 * "Searched your workspace, found 3 passages", closed by default. A run that
 * read live records says "Searched your workspace, made 2 reads" instead
 * (plan 0.9.0 L2b).
 */
export function StepSummary({ steps }: { readonly steps: readonly Step[] }) {
  const { t } = useTranslations();
  if (steps.length === 0) {
    return null;
  }
  const found = [...steps]
    .reverse()
    .find(
      (step): step is Extract<Step, { step: "found" }> => step.step === "found",
    );
  // Reads of live records, when the run made any, are what the answer rests
  // on, so they are what the line counts.
  const reads = steps.filter((step) => step.step === "reading").length;
  const summary =
    reads > 0
      ? reads === 1
        ? t("copilot.copilotPanel.step.summaryReadOne", { count: reads })
        : t("copilot.copilotPanel.step.summaryReadOther", { count: reads })
      : found === undefined
        ? t("copilot.copilotPanel.step.summarySearched")
        : found.count === 0
          ? t("copilot.copilotPanel.step.summaryNone")
          : found.count === 1
            ? t("copilot.copilotPanel.step.summaryOne", { count: found.count })
            : t("copilot.copilotPanel.step.summaryOther", {
                count: found.count,
              });
  return (
    <details className="group text-xs text-ink-3">
      <summary className="w-fit cursor-pointer rounded-control hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-strong">
        {summary}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-1">
        {steps.map((step, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps only grow, in order.
          <li key={index} className="flex items-center gap-1.5">
            <Check className="size-3 text-ok" aria-hidden="true" />
            {stepWords(step, t)}
          </li>
        ))}
      </ul>
    </details>
  );
}
