"use client";

/**
 * Stage nine: keep, modify or abandon (UIUX-PLAN.md S-24, METHOD.md §8.8,
 * P4-T11c-a).
 *
 * Every objective closed deliberately, with one decision and a one-line why.
 *
 * **Nothing is pre-selected.** §8.8's closing line is "nothing carries over by
 * default", and a screen that arrives with keep chosen is the automatic
 * carry-over wearing a decision's clothes. Same reasoning as the monthly trend
 * buttons (P4-T09) and the root-cause picker (P4-T11b).
 *
 * **The meaning of each decision comes from the read.** METHOD.md §8.8 defines
 * what keep, modify and abandon mean, and a screen writing its own gloss on
 * "modify" is a screen that will disagree with the document.
 *
 * **The decision does not close the objective**, and the schema is why: a close
 * carries its outcome, its decision and a retrospective together or it is not a
 * close, and stage nine collects only the decision. What that means for actually
 * closing an objective is an open question on the P4-T11c-a row.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { decideObjectiveAction } from "./actions";

/** §8.8's three. The meanings come from the read; these are just the words. */
const DECISIONS = ["keep", "modify", "abandon"] as const;
type DecisionKind = (typeof DECISIONS)[number];

interface ResetObjective {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly score: number | null;
  readonly decision: DecisionKind | null;
  readonly meaning: string | null;
  readonly why: string | null;
}

export interface Reset {
  readonly objectives: readonly ResetObjective[];
  readonly decided: number;
  readonly total: number;
  readonly complete: boolean;
}

function ObjectiveRow({
  sessionId,
  objective,
  canDecide,
  onProblem,
}: {
  readonly sessionId: string;
  readonly objective: ResetObjective;
  readonly canDecide: boolean;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<DecisionKind | null>(objective.decision);
  const [why, setWhy] = useState(objective.why ?? "");

  const save = useCallback(() => {
    onProblem(null);
    if (chosen === null) {
      onProblem("Choose keep, modify or abandon first.");
      return;
    }
    if (why.trim().length === 0) {
      onProblem(
        "§8.8 asks for one line on why. A decision nobody explained is the carry-over it exists to stop.",
      );
      return;
    }
    startTransition(async () => {
      try {
        await decideObjectiveAction(
          sessionId,
          objective.goalId,
          chosen,
          why.trim(),
        );
        router.refresh();
      } catch (error) {
        onProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [chosen, objective.goalId, onProblem, router, sessionId, why]);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-2.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm text-ink">{objective.goalTitle}</span>
        {objective.score === null ? null : (
          // The score sits beside the decision as evidence, because §8.8 asks a
          // room to decide on what happened rather than on a feeling about it.
          <Chip tone="neutral">{objective.score.toFixed(2)}</Chip>
        )}
        {objective.decision === null ? (
          <Chip tone="warn">undecided</Chip>
        ) : (
          <Chip tone="ok">{objective.decision}</Chip>
        )}
      </span>

      {objective.meaning === null ? null : (
        <span className="text-xs text-ink-3">{objective.meaning}</span>
      )}

      {canDecide ? (
        <>
          <fieldset
            aria-label={`Decision for ${objective.goalTitle}`}
            className="flex flex-wrap gap-1.5 border-0 p-0"
          >
            {DECISIONS.map((decision) => (
              <Button
                key={decision}
                type="button"
                size="sm"
                variant={chosen === decision ? "default" : "ghost"}
                disabled={pending}
                onClick={() => setChosen(decision)}
              >
                {decision}
              </Button>
            ))}
          </fieldset>
          <label
            className="flex flex-col gap-1"
            htmlFor={`why-${objective.goalId}`}
          >
            <span className="text-xs font-medium text-ink-3">
              One line on why
            </span>
            <input
              id={`why-${objective.goalId}`}
              type="text"
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={why}
              disabled={pending}
              placeholder="What the room actually said"
              onChange={(event) => setWhy(event.target.value)}
            />
          </label>
          <span>
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {objective.decision === null
                ? "Close it deliberately"
                : "Change the decision"}
            </Button>
          </span>
        </>
      ) : objective.why === null ? null : (
        <span className="text-xs text-ink-3">{objective.why}</span>
      )}
    </li>
  );
}

export function ResetPanel({
  sessionId,
  reset,
  canDecide,
}: {
  readonly sessionId: string;
  readonly reset: Reset;
  readonly canDecide: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Card role="region" aria-labelledby="reset-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2 id="reset-heading" className="flex-1 text-sm font-bold text-ink">
            Keep, modify or abandon
          </h2>
          <Chip tone={reset.complete ? "ok" : "neutral"}>
            {reset.decided} of {reset.total} decided
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">
        {reset.objectives.length === 0 ? (
          <p className="text-sm text-ink-3">
            No open objectives in this space and cycle, so there is nothing to
            close.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reset.objectives.map((objective) => (
              <ObjectiveRow
                key={objective.goalId}
                sessionId={sessionId}
                objective={objective}
                canDecide={canDecide}
                onProblem={setProblem}
              />
            ))}
          </ul>
        )}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        {reset.objectives.length === 0 ? null : (
          <p className="text-xs text-ink-4">
            Nothing carries over by default. A carried objective re-enters the
            next cycle as an issue and has to survive prioritisation on its
            merits.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
