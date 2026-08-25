"use client";

/**
 * Stage two: grading the key results and revealing the scores (UIUX-PLAN.md
 * S-24, METHOD.md §8.3, P4-T10b-a and P4-T10b-b).
 *
 * One row per key result, with §8.3's evidence beside the slider: baseline,
 * target and where the number actually landed. Grading happens against the key
 * result as written, so the evidence is read from the key result rather than
 * typed into the review.
 *
 * **The objective score is not on this screen until the room reveals it**, and
 * the screen is not what keeps it back: `sessions.scoringStatus` returns null
 * for an unrevealed objective, so a second surface cannot show what this one
 * hides. Showing a running number would be the reveal happening by accident,
 * one grade at a time.
 *
 * **The reveal animates in CSS, deliberately.** The design system's one
 * reduced-motion override collapses every CSS animation and transition to
 * nothing (`packages/ui/src/styles/tokens.css` §2), so `.animate-pop` is
 * instant for a reader who asked for that and nothing here has to check. A
 * JavaScript count-up would keep counting straight through that override, which
 * is the trap this note exists to mark.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { verdictLabel, verdictTone } from "../../../lib/verdict";
import { revealObjectiveScoreAction, scoreKeyResultAction } from "./actions";

interface ScoringKeyResult {
  readonly keyResultId: string;
  readonly title: string;
  readonly weight: number;
  readonly baseline: number | null;
  readonly target: number | null;
  readonly current: number | null;
  readonly unit: string | null;
  readonly score: number | null;
  readonly reason: string | null;
}

interface ScoringObjective {
  readonly goalId: string;
  /** Null until the room reveals it (§8.3). */
  readonly score: number | null;
  readonly goalTitle: string;
  readonly revealed: boolean;
  readonly scored: number;
  readonly total: number;
  readonly keyResults: readonly ScoringKeyResult[];
}

export interface ScoringStatus {
  readonly objectives: readonly ScoringObjective[];
  readonly cycleScore: number | null;
  readonly verdict: string | null;
  readonly complete: boolean;
}

/** `120 → 300 teams, landed 210`, with whatever of that is known. */
function evidence(keyResult: ScoringKeyResult): string {
  const unit = keyResult.unit ? ` ${keyResult.unit}` : "";
  const bounds =
    keyResult.baseline === null || keyResult.target === null
      ? null
      : `${keyResult.baseline} to ${keyResult.target}${unit}`;
  const landed =
    keyResult.current === null ? null : `landed ${keyResult.current}${unit}`;
  return [bounds, landed].filter(Boolean).join(", ") || "No numbers recorded";
}

function ScoreRow({
  sessionId,
  keyResult,
  canScore,
  onProblem,
}: {
  readonly sessionId: string;
  readonly keyResult: ScoringKeyResult;
  readonly canScore: boolean;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Nought when ungraded, because a slider has to sit somewhere. The stored
  // score stays null until the room presses save, so an untouched slider is not
  // a grade of zero.
  const [score, setScore] = useState(keyResult.score ?? 0);
  const [reason, setReason] = useState(keyResult.reason ?? "");

  const save = useCallback(() => {
    onProblem(null);
    if (reason.trim().length === 0) {
      onProblem(
        "§8.3 asks for one line on why. A score with no reason is refused.",
      );
      return;
    }
    startTransition(async () => {
      try {
        await scoreKeyResultAction(
          sessionId,
          keyResult.keyResultId,
          score,
          reason.trim(),
        );
        router.refresh();
      } catch (error) {
        onProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [keyResult.keyResultId, onProblem, reason, router, score, sessionId]);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-2.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm text-ink">{keyResult.title}</span>
        {keyResult.weight === 1 ? null : (
          // The weight is visible because it changes what the objective score
          // will be, and a room that cannot see it cannot argue with it.
          <Chip tone="neutral">weight {keyResult.weight}</Chip>
        )}
        {keyResult.score === null ? (
          <Chip tone="warn">not graded</Chip>
        ) : (
          <Chip tone="ok">{keyResult.score.toFixed(1)}</Chip>
        )}
      </span>

      {/* §8.3's evidence: grade against the key result as written. */}
      <span className="text-xs text-ink-3">{evidence(keyResult)}</span>

      {canScore ? (
        <>
          <label
            className="flex flex-wrap items-center gap-2"
            htmlFor={`score-${keyResult.keyResultId}`}
          >
            <span className="text-xs font-medium text-ink-3">Score</span>
            <input
              id={`score-${keyResult.keyResultId}`}
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={score}
              disabled={pending}
              className="flex-1"
              onChange={(event) => setScore(Number(event.target.value))}
            />
            <span className="w-8 text-sm tabular-nums text-ink">
              {score.toFixed(1)}
            </span>
          </label>
          <label
            className="flex flex-col gap-1"
            htmlFor={`reason-${keyResult.keyResultId}`}
          >
            <span className="text-xs font-medium text-ink-3">
              One line on why
            </span>
            <input
              id={`reason-${keyResult.keyResultId}`}
              type="text"
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={reason}
              disabled={pending}
              placeholder="Facts, not feelings"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <span>
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {keyResult.score === null ? "Save the grade" : "Change it"}
            </Button>
          </span>
        </>
      ) : null}
    </li>
  );
}

/**
 * The hidden number, the button that puts it out, and the number once it is out.
 *
 * §8.3 has the room grading together and revealing together, which in practice
 * is the facilitator saying now. `sessions.revealObjectiveScore` is what refuses
 * anybody else; this only decides whether to draw the control.
 */
function Reveal({
  sessionId,
  objective,
  canReveal,
  onProblem,
}: {
  readonly sessionId: string;
  readonly objective: ScoringObjective;
  readonly canReveal: boolean;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const reveal = useCallback(() => {
    onProblem(null);
    startTransition(async () => {
      try {
        await revealObjectiveScoreAction(sessionId, objective.goalId);
        router.refresh();
      } catch (error) {
        onProblem(
          error instanceof Error ? error.message : "That did not reveal.",
        );
      }
    });
  }, [objective.goalId, onProblem, router, sessionId]);

  if (objective.revealed && objective.score !== null) {
    return (
      <p className="flex flex-wrap items-baseline gap-2">
        {/* Keyed on the number so a regrade animates again rather than
            silently swapping one figure for another. */}
        <span
          key={objective.score}
          className="animate-pop text-2xl font-bold tabular-nums text-ink"
        >
          {objective.score.toFixed(2)}
        </span>
        <span className="text-xs text-ink-3">
          this objective's score, weighted by each key result's weight
        </span>
      </p>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="flex-1 text-xs text-ink-4">
        {objective.scored === 0
          ? "Nothing is graded yet, so there is no score to reveal."
          : "This objective's score stays hidden until the room reveals it together."}
      </span>
      {canReveal && objective.scored > 0 ? (
        <Button type="button" size="sm" disabled={pending} onClick={reveal}>
          Reveal the score
        </Button>
      ) : null}
    </span>
  );
}

export function Scoring({
  sessionId,
  status,
  canScore,
  canReveal,
}: {
  readonly sessionId: string;
  readonly status: ScoringStatus;
  readonly canScore: boolean;
  readonly canReveal: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {status.objectives.length === 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              Score the key results
            </h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-ink-3">
              No open objectives in this space and cycle, so there is nothing to
              grade.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {status.objectives.map((objective) => (
        <Card key={objective.goalId}>
          <CardHeader>
            <span className="flex flex-wrap items-center gap-2">
              <h2 className="flex-1 text-sm font-bold text-ink">
                {objective.goalTitle}
              </h2>
              <Chip
                tone={objective.scored === objective.total ? "ok" : "neutral"}
              >
                {objective.scored} of {objective.total} graded
              </Chip>
              {objective.revealed ? <Chip tone="info">revealed</Chip> : null}
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {objective.keyResults.map((keyResult) => (
                <ScoreRow
                  key={keyResult.keyResultId}
                  sessionId={sessionId}
                  keyResult={keyResult}
                  canScore={canScore}
                  onProblem={setProblem}
                />
              ))}
            </ul>
            <Reveal
              sessionId={sessionId}
              objective={objective}
              canReveal={canReveal}
              onProblem={setProblem}
            />
          </CardBody>
        </Card>
      ))}

      {problem === null ? null : <p className="text-sm text-bad">{problem}</p>}

      {status.objectives.length === 0 ? null : (
        <>
          {/* §8.6's running average, over the revealed objectives only. An
              average that counted grades the room had not put out would be the
              hidden number under another label, because on a review with one
              objective and even weights the two figures are the same. */}
          {status.cycleScore === null ? (
            <p className="text-xs text-ink-4">
              The cycle score appears as objectives are revealed. It averages
              the key results of what the room has put out, so nothing reaches
              it early.
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-3">
                Cycle score so far
              </span>
              <span
                key={status.cycleScore}
                className="animate-pop text-lg font-bold tabular-nums text-ink"
              >
                {status.cycleScore.toFixed(2)}
              </span>
              <Chip tone={verdictTone(status.verdict)}>
                {verdictLabel(status.verdict)}
              </Chip>
            </p>
          )}
          <p className="text-xs text-ink-4">
            {status.complete
              ? "Every key result is graded. The stage can end."
              : "Every key result needs a grade and one line on why before the stage ends."}{" "}
            Grades land on the key results when the review closes, not before.
          </p>
        </>
      )}
    </div>
  );
}
