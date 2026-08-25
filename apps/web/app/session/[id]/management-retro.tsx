"use client";

/**
 * Stage six: the management retro (UIUX-PLAN.md S-24, METHOD.md §8.1 stage 6,
 * §8.7, P4-T11a).
 *
 * The four questions leadership answers out loud, recorded as they go.
 *
 * **The questions come from `packages/method`, never from a row.** §11 lists the
 * management-retro questions as unchangeable structure, so storing their text
 * would let a workspace edit one and would leave old answers quoting a question
 * nobody asked.
 *
 * **This panel is only rendered for the audience that may read it.**
 * `sessions.managementRetro` returns not-found to anybody who is not a manager
 * or the coordinator of the review's space, so the screen is not what keeps the
 * two retros apart. What an ordinary member sees is the short note the page
 * renders in its place, which says the stage is leadership's without saying what
 * is in it.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { setManagementAnswerAction } from "./actions";

interface ManagementQuestion {
  readonly questionKey: number;
  readonly question: string;
  readonly body: string | null;
  readonly answeredByName: string | null;
}

export interface ManagementRetro {
  readonly questions: readonly ManagementQuestion[];
  readonly answered: number;
  readonly complete: boolean;
}

function QuestionRow({
  sessionId,
  question,
  canAnswer,
  onProblem,
}: {
  readonly sessionId: string;
  readonly question: ManagementQuestion;
  readonly canAnswer: boolean;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(question.body ?? "");

  const save = useCallback(() => {
    onProblem(null);
    if (body.trim().length === 0) {
      onProblem("An unanswered question is better left unanswered than blank.");
      return;
    }
    startTransition(async () => {
      try {
        await setManagementAnswerAction(
          sessionId,
          question.questionKey,
          body.trim(),
        );
        setOpen(false);
        router.refresh();
      } catch (error) {
        onProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [body, onProblem, question.questionKey, router, sessionId]);

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold text-ink-3">
          {question.questionKey}
        </span>
        <span className="flex-1 text-sm text-ink">{question.question}</span>
        {question.body === null ? (
          <Chip tone="warn">unanswered</Chip>
        ) : (
          <Chip tone="ok">answered</Chip>
        )}
      </span>

      {question.body === null ? null : (
        <span className="text-sm text-ink-2">
          {question.body}
          {question.answeredByName ? (
            <span className="text-xs text-ink-4">
              {" "}
              — {question.answeredByName}
            </span>
          ) : null}
        </span>
      )}

      {canAnswer && !open ? (
        <span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setOpen(true)}
          >
            {question.body === null ? "Answer it" : "Change the answer"}
          </Button>
        </span>
      ) : null}

      {canAnswer && open ? (
        <>
          <label
            className="flex flex-col gap-1"
            htmlFor={`answer-${question.questionKey}`}
          >
            <span className="sr-only">{question.question}</span>
            <textarea
              id={`answer-${question.questionKey}`}
              rows={3}
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={body}
              disabled={pending}
              placeholder="What leadership actually said"
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              Save the answer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </span>
        </>
      ) : null}
    </li>
  );
}

export function ManagementRetroPanel({
  sessionId,
  retro,
  canAnswer,
}: {
  readonly sessionId: string;
  readonly retro: ManagementRetro;
  readonly canAnswer: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Card role="region" aria-labelledby="management-retro-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="management-retro-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            Management retro
          </h2>
          <Chip tone={retro.complete ? "ok" : "neutral"}>
            {retro.answered} of {retro.questions.length} answered
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {retro.questions.map((question) => (
            <QuestionRow
              key={question.questionKey}
              sessionId={sessionId}
              question={question}
              canAnswer={canAnswer}
              onProblem={setProblem}
            />
          ))}
        </ul>

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        <p className="text-xs text-ink-4">
          Read by this space's managers and its coordinator. The four questions
          are fixed: they are the practice, not a template.
        </p>
      </CardBody>
    </Card>
  );
}
