"use client";

import type { ReviewAct, TimedReviewStage } from "@openokr/method";
/**
 * The quarterly review's shell (UIUX-PLAN.md S-24, METHOD.md §8.1, P4-T10a-a).
 *
 * Four parts, and the mockup's composition: the header chip with the stage and
 * its timer, the lap bar segmented by duration, the rail of eleven stages
 * grouped by act, and the facilitator's private note for whichever stage is
 * running.
 *
 * **The timer ticks in the browser and the clock is the server's.** Everything
 * it needs is `stageStartedAt` and the stage's budget, so a client that
 * reconnects lands on the right second without asking. Nothing about elapsed
 * time is stored while a stage runs: `sessions.advanceStage` writes the seconds
 * when the stage ends, which is the one moment the number stops moving.
 *
 * **Going over is visible rather than prevented** (§8.1). Past the budget the
 * readout keeps counting and turns, because a facilitator needs to know how far
 * over they are, and a timer that stopped at zero would hide exactly that.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { addMinuteAction, setStageNoteAction } from "./actions";

const ACT_LABELS: Record<ReviewAct, string> = {
  open: "Open",
  review: "Review",
  retro: "Retro",
  reset: "Reset",
};

/** `4:12`, and `12:03` past ten minutes. Never negative. */
function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function QuarterlyReview({
  sessionId,
  stages,
  stageHasPanel,
  stageKeys,
  currentStageKey,
  stageStartedAt,
  elapsed,
  addedMinutes,
  note,
  isFacilitator,
  isRunning,
}: {
  readonly sessionId: string;
  readonly stages: readonly TimedReviewStage[];
  /**
   * Whether the running stage has a panel of its own on this page.
   *
   * Decided by `page.tsx`, which is what renders the panels, rather than by a
   * list of built stages kept here: two places tracking that is one place to
   * forget when the next stage lands.
   */
  readonly stageHasPanel: boolean;
  readonly stageKeys: readonly string[];
  readonly currentStageKey: string | null;
  readonly stageStartedAt: string | null;
  readonly elapsed: Record<string, number>;
  readonly addedMinutes: Record<string, number>;
  readonly note: string;
  readonly isFacilitator: boolean;
  readonly isRunning: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState(note);
  const [now, setNow] = useState(() => Date.now());

  // One second, and only while a stage is actually running. A timer left
  // ticking on a closed session is a screen that looks live and is not.
  useEffect(() => {
    if (!isRunning || !stageStartedAt) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, stageStartedAt]);

  // **The draft belongs to the stage, and resets when the stage does.**
  //
  // Adjusted during render rather than in an effect, which is what React
  // recommends for state derived from a prop change, and here it is also the
  // only shape that is correct: an effect keyed on `note` alone would not fire
  // when two stages hold the same text, so unsaved typing from stage one would
  // follow the facilitator into stage two and be written there on the next
  // save. Keying on the stage answers that directly.
  const [draftStage, setDraftStage] = useState(currentStageKey);
  if (draftStage !== currentStageKey) {
    setDraftStage(currentStageKey);
    setNoteDraft(note);
  }

  const run = useCallback(
    (work: () => Promise<unknown>) => {
      setProblem(null);
      startTransition(async () => {
        try {
          await work();
          router.refresh();
        } catch (error) {
          setProblem(
            error instanceof Error ? error.message : "That did not save.",
          );
        }
      });
    },
    [router],
  );

  const currentIndex = currentStageKey
    ? stageKeys.indexOf(currentStageKey)
    : -1;
  const current = currentIndex >= 0 ? stages[currentIndex] : undefined;

  const budgetFor = (index: number): number => {
    const key = stageKeys[index] ?? "";
    return ((stages[index]?.minutes ?? 0) + (addedMinutes[key] ?? 0)) * 60;
  };

  const spent = stageStartedAt
    ? Math.round((now - new Date(stageStartedAt).getTime()) / 1000)
    : 0;
  const budget = currentIndex >= 0 ? budgetFor(currentIndex) : 0;
  const over = budget > 0 && spent > budget;

  // The whole agenda, so the segments are proportional to how long each stage
  // actually gets rather than each being a fixed eleventh.
  const totalSeconds = stages.reduce(
    (sum, _stage, index) => sum + budgetFor(index),
    0,
  );

  const acts: ReviewAct[] = ["open", "review", "retro", "reset"];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {current ? (
          <Chip tone="info">
            Stage {current.stage} of {stages.length} · {current.title}
          </Chip>
        ) : (
          <Chip tone="neutral">Not started</Chip>
        )}
        {current && isRunning ? (
          <>
            {/* Tabular, so the digits do not jump every second. */}
            <Chip tone={over ? "bad" : "neutral"}>
              <span className="tabular-nums">
                {clock(spent)} of {clock(budget)}
              </span>
            </Chip>
            {isFacilitator ? (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => run(() => addMinuteAction(sessionId))}
              >
                + 1 min
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {/* The lap bar. Eleven segments, each as wide as its stage is long. */}
      <div
        className="flex h-2 w-full gap-1 overflow-hidden"
        role="img"
        aria-label={
          current
            ? `Stage ${current.stage} of ${stages.length}`
            : "The review has not started"
        }
      >
        {stages.map((stage, index) => {
          const width = totalSeconds
            ? (budgetFor(index) / totalSeconds) * 100
            : 100 / stages.length;
          const done = currentIndex >= 0 && index < currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <span
              key={stage.stage}
              style={{ width: `${width}%` }}
              className={[
                "rounded-full",
                done ? "bg-ok" : isCurrent ? "bg-brand" : "bg-raised",
              ].join(" ")}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Named, so it is a landmark a screen reader can jump to and a test
            can scope to. The act labels are single words that appear all over
            the shell. */}
        <Card
          role="region"
          aria-labelledby="review-stages-heading"
          className="lg:w-72 lg:flex-none"
        >
          <CardHeader>
            <h2
              id="review-stages-heading"
              className="text-sm font-bold text-ink"
            >
              Stages
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {acts.map((act) => {
              const inAct = stages
                .map((stage, index) => ({ stage, index }))
                .filter((entry) => entry.stage.act === act);
              if (inAct.length === 0) {
                return null;
              }
              return (
                <div key={act} className="flex flex-col gap-1">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-ink-4">
                    {ACT_LABELS[act]}
                  </span>
                  <ul className="flex flex-col gap-0.5">
                    {inAct.map(({ stage, index }) => {
                      const key = stageKeys[index] ?? "";
                      const done = currentIndex >= 0 && index < currentIndex;
                      const isCurrent = index === currentIndex;
                      const added = addedMinutes[key] ?? 0;
                      return (
                        <li
                          key={stage.stage}
                          className={[
                            "flex items-center gap-2 rounded-md px-2 py-1.5",
                            isCurrent ? "bg-brand-weak" : "",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "flex h-5 w-5 flex-none items-center justify-center rounded-full text-2xs font-semibold",
                              done
                                ? "bg-ok text-on-ok"
                                : isCurrent
                                  ? "bg-brand text-on-brand"
                                  : "bg-raised text-ink-3",
                            ].join(" ")}
                          >
                            {done ? "✓" : stage.stage}
                          </span>
                          <span className="flex-1 text-sm text-ink">
                            {stage.title}
                          </span>
                          <span className="flex-none text-xs tabular-nums text-ink-3">
                            {/* The minutes actually available, so a stage the
                                room extended reads as the time it now has. */}
                            {stage.minutes + added}
                            {added > 0 ? "*" : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {Object.values(addedMinutes).some((added) => added > 0) ? (
              <p className="text-2xs text-ink-4">
                * includes minutes added in this review. The workspace's own
                agenda is unchanged.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex flex-1 flex-col gap-4">
          {isFacilitator && isRunning && current ? (
            <Card>
              <CardHeader>
                <span className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-ink">
                    Your note on this stage
                  </h2>
                  <Chip tone="neutral">private</Chip>
                </span>
              </CardHeader>
              <CardBody className="flex flex-col gap-2">
                <textarea
                  className="min-h-20 w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                  value={noteDraft}
                  aria-label={`Private note for ${current.title}`}
                  placeholder="Only you can read this"
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => setStageNoteAction(sessionId, noteDraft))
                    }
                  >
                    Save the note
                  </Button>
                  <span className="text-xs text-ink-4">
                    One note per stage. Nobody else in the room can see it, and
                    it is not in the activity feed.
                  </span>
                </span>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              {/* **Not the stage title when the stage has its own panel.** The
                  panel already carries that heading, and two identical level-two
                  headings on one page is a duplicate for a screen reader and an
                  ambiguous target for anything else looking for the panel. */}
              <h2 className="text-sm font-bold text-ink">
                {current
                  ? stageHasPanel
                    ? "This stage"
                    : current.title
                  : "The review"}
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              {current ? (
                <>
                  <p className="text-sm text-ink-2">{current.purpose}</p>
                  {stageHasPanel ? null : (
                    <p className="text-xs text-ink-4">
                      {/* Every one of the eleven stages has a panel since
                          P4-T12, so `stageHasPanel` is true in practice and
                          this is the floor rather than a state anybody meets.
                          It named three tasks that had all landed until the gap
                          audit of 7 September 2026; a fallback that lies is
                          worse than one that admits it does not know. */}
                      This stage has no panel on this screen. The rail, the
                      pacing and the notes work, and the stage can still be
                      advanced.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-3">
                  Eleven stages across three acts, sixty minutes. The
                  facilitator opens it when the room is together.
                </p>
              )}
              {Object.keys(elapsed).length > 0 ? (
                <p className="text-xs text-ink-4">
                  Time spent so far:{" "}
                  {stages
                    .map((stage, index) => ({
                      stage,
                      seconds: elapsed[stageKeys[index] ?? ""] ?? 0,
                    }))
                    .filter((entry) => entry.seconds > 0)
                    .map(
                      (entry) => `${entry.stage.title} ${clock(entry.seconds)}`,
                    )
                    .join(", ")}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {problem === null ? null : (
            <p className="text-sm text-bad">{problem}</p>
          )}
        </div>
      </div>
    </div>
  );
}
