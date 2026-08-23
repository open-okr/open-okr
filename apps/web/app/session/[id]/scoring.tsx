"use client";

/**
 * Stage two: grading the key results (UIUX-PLAN.md S-24, METHOD.md §8.3,
 * P4-T10b-a).
 *
 * One row per key result, with §8.3's evidence beside the slider: baseline,
 * target and where the number actually landed. Grading happens against the key
 * result as written, so the evidence is read from the key result rather than
 * typed into the review.
 *
 * **The objective score is deliberately not here.** §8.3 hides it until the room
 * reveals it together, and P4-T10b-b is the reveal. What this screen shows is
 * how many of an objective's key results are graded, which is what a facilitator
 * needs to know whether the stage can end. Showing the running number would be
 * the reveal happening by accident, one grade at a time.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { scoreKeyResultAction } from "./actions";

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
  readonly goalTitle: string;
  readonly score: number | null;
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

export function Scoring({
  sessionId,
  status,
  canScore,
}: {
  readonly sessionId: string;
  readonly status: ScoringStatus;
  readonly canScore: boolean;
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
            <p className="text-xs text-ink-4">
              {/* Named rather than shown. §8.3 hides the objective score until
                  the room reveals it, and a running number here would be the
                  reveal happening one grade at a time. */}
              This objective's score stays hidden until the room reveals it
              together. The reveal arrives with P4-T10b-b.
            </p>
          </CardBody>
        </Card>
      ))}

      {problem === null ? null : <p className="text-sm text-bad">{problem}</p>}

      {status.objectives.length === 0 ? null : (
        <p className="text-xs text-ink-4">
          {status.complete
            ? "Every key result is graded. The stage can end."
            : "Every key result needs a grade and one line on why before the stage ends."}{" "}
          Grades land on the key results when the review closes, not before.
        </p>
      )}
    </div>
  );
}
