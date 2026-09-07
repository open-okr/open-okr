"use client";

/**
 * Stage three: objective narratives (UIUX-PLAN.md S-24, METHOD.md §8.1 stage 3,
 * P4-T10c).
 *
 * Owner by owner, the story behind the score and what the number does not show.
 * The facilitator hands the mic to one objective at a time and puts it down when
 * the round is over.
 *
 * **Exactly one objective holds the mic, and the server is what guarantees it.**
 * `okr_sessions.mic_goal_id` is a single pointer, so two holders is not a state
 * the data can be in. This component draws whoever the read says holds it and
 * never tracks a holder of its own, because a second copy of that answer is a
 * second answer.
 *
 * **The narrative is a textarea, not an editor.** It is collected as plain text
 * and becomes editor JSON through the one shared rich text module in the server
 * action, the same path the check-in composer uses (P3-T07). A stage with nine
 * minutes of talking in it does not need a toolbar.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { passMicAction, setNarrativeAction } from "./actions";

interface NarrativeObjective {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly championName: string | null;
  readonly hasMic: boolean;
  readonly spokenAt: string | null;
  /** A plain-text excerpt of the stored body, or null when nothing was typed. */
  readonly excerpt: string | null;
  readonly authorName: string | null;
}

export interface Narratives {
  readonly micGoalId: string | null;
  readonly objectives: readonly NarrativeObjective[];
  readonly spoken: number;
  readonly total: number;
  readonly complete: boolean;
}

function ObjectiveRow({
  sessionId,
  objective,
  canWrite,
  canPassMic,
  onProblem,
}: {
  readonly sessionId: string;
  readonly objective: NarrativeObjective;
  readonly canWrite: boolean;
  readonly canPassMic: boolean;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(objective.excerpt ?? "");

  const run = useCallback(
    (work: () => Promise<unknown>) => {
      onProblem(null);
      startTransition(async () => {
        try {
          await work();
          router.refresh();
        } catch (error) {
          onProblem(
            error instanceof Error ? error.message : "That did not save.",
          );
        }
      });
    },
    [onProblem, router],
  );

  return (
    <li
      className={`flex flex-col gap-2 rounded-md border p-2.5 ${
        objective.hasMic ? "border-brand bg-brand-weak" : "border-line"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm text-ink">{objective.goalTitle}</span>
        {objective.championName ? (
          // Whose story it is. §8.1 stage 3 is owner by owner, so the room needs
          // to know who to look at.
          <Chip tone="neutral">{objective.championName}</Chip>
        ) : null}
        {objective.hasMic ? <Chip tone="info">speaking</Chip> : null}
        {objective.spokenAt === null ? null : <Chip tone="ok">spoken</Chip>}
      </span>

      {objective.excerpt === null ? null : (
        <span className="text-xs text-ink-3">
          {objective.excerpt}
          {objective.authorName ? ` — ${objective.authorName}` : ""}
        </span>
      )}

      <span className="flex flex-wrap items-center gap-2">
        {canPassMic && !objective.hasMic ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => passMicAction(sessionId, objective.goalId))
            }
          >
            Give them the mic
          </Button>
        ) : null}
        {canPassMic && objective.hasMic ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => passMicAction(sessionId, null))}
          >
            Put the mic down
          </Button>
        ) : null}
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setOpen((was) => !was)}
          >
            {open
              ? "Cancel"
              : objective.excerpt === null
                ? "Add what the number does not show"
                : "Change the note"}
          </Button>
        ) : null}
      </span>

      {open && canWrite ? (
        <>
          <label
            className="flex flex-col gap-1"
            htmlFor={`narrative-${objective.goalId}`}
          >
            <span className="text-xs font-medium text-ink-3">
              What the number does not show
            </span>
            <textarea
              id={`narrative-${objective.goalId}`}
              rows={3}
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={text}
              disabled={pending}
              placeholder="The part the score cannot say"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await setNarrativeAction(
                    sessionId,
                    objective.goalId,
                    text.trim(),
                  );
                  setOpen(false);
                })
              }
            >
              Save the note
            </Button>
            <span className="text-xs text-ink-4">
              {/* Clearing it is a real act, and it does not un-tell the story:
                  `spoken_at` stays where it is. */}
              Saving an empty note removes it. It does not undo that the
              objective was spoken for.
            </span>
          </span>
        </>
      ) : null}
    </li>
  );
}

export function NarrativesPanel({
  sessionId,
  narratives,
  canWrite,
  canPassMic,
}: {
  readonly sessionId: string;
  readonly narratives: Narratives;
  readonly canWrite: boolean;
  readonly canPassMic: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    // **A named landmark, not a bare card.** `Card` is a plain div, so a panel
    // without this is unreachable by name: it is not a region, and anything
    // looking for it by its words finds the stage rail first, which lists every
    // stage by name. Naming the panel is also what a screen reader needs to skip
    // to it.
    <Card role="region" aria-labelledby="narratives-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="narratives-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            Objective narratives
          </h2>
          <Chip tone={narratives.complete ? "ok" : "neutral"}>
            {narratives.spoken} of {narratives.total} spoken for
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">
        {narratives.objectives.length === 0 ? (
          <p className="text-sm text-ink-3">
            No open objectives in this space and cycle, so there is nothing to
            talk through.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {narratives.objectives.map((objective) => (
              <ObjectiveRow
                key={objective.goalId}
                sessionId={sessionId}
                objective={objective}
                canWrite={canWrite}
                canPassMic={canPassMic}
                onProblem={setProblem}
              />
            ))}
          </ul>
        )}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        {narratives.objectives.length === 0 ? null : (
          <p className="text-xs text-ink-4">
            {narratives.complete
              ? "Every objective has had its turn. The stage can end."
              : "The mic moves on when an owner finishes, and that is what marks their objective spoken for."}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
