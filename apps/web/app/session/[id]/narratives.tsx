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
 * **The narrative is the compact editor** (docs/design/guided-inputs.md §4.7),
 * as the check-in narrative is, and is shown as it was written. It was a
 * textarea whose text became one paragraph per blank line on save, so a list
 * somebody typed while the owner spoke came back as a run of lines.
 */
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  isBlankDocument,
  RichTextEditor,
  RichTextView,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { passMicAction, setNarrativeAction } from "./actions";

interface NarrativeObjective {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly championName: string | null;
  readonly hasMic: boolean;
  readonly spokenAt: string | null;
  /** The stored body, for the editor to open on. */
  readonly body: unknown;
  /** The body rendered on the server, or null when nothing was written. */
  readonly html: string | null;
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
  const { t } = useTranslations();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [written, setWritten] = useState<unknown>(objective.body);

  const run = useCallback(
    (work: () => Promise<unknown>) => {
      onProblem(null);
      startTransition(async () => {
        try {
          await work();
          router.refresh();
        } catch (error) {
          onProblem(
            error instanceof Error
              ? error.message
              : t("session.detail.thatDidNotSave"),
          );
        }
      });
    },
    [onProblem, router, t],
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
        {objective.hasMic ? (
          <Chip tone="info">{t("session.detail.narratives.speaking")}</Chip>
        ) : null}
        {objective.spokenAt === null ? null : (
          <Chip tone="ok">{t("session.detail.narratives.spoken")}</Chip>
        )}
      </span>

      {objective.html === null ? null : (
        <div className="flex flex-col gap-0.5 text-xs text-ink-3">
          <RichTextView html={objective.html} />
          {objective.authorName ? <span>— {objective.authorName}</span> : null}
        </div>
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
            {t("session.detail.narratives.giveThemTheMic")}
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
            {t("session.detail.narratives.putTheMicDown")}
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
              ? t("common.cancel")
              : objective.html === null
                ? t("session.detail.narratives.addWhatTheNumber")
                : t("session.detail.narratives.changeTheNote")}
          </Button>
        ) : null}
      </span>

      {open && canWrite ? (
        <>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-xs font-medium text-ink-3">
              {t("session.detail.narratives.whatTheNumberDoes")}
            </legend>
            <div className="rounded-md border border-line bg-surface p-2 text-sm text-ink focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line">
              <RichTextEditor
                label={t("session.detail.narratives.whatTheNumberDoes")}
                variant="compact"
                content={objective.body}
                editable={!pending}
                placeholder={t("session.detail.narratives.thePartTheScore")}
                onUpdate={setWritten}
              />
            </div>
          </fieldset>
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
                    isBlankDocument(written) ? null : written,
                  );
                  setOpen(false);
                })
              }
            >
              {t("common.saveTheNote")}
            </Button>
            <span className="text-xs text-ink-4">
              {/* Clearing it is a real act, and it does not un-tell the story:
                  `spoken_at` stays where it is. */}
              {t("session.detail.narratives.savingAnEmptyNote")}
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
  const { t } = useTranslations();

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
            {t("common.objectiveNarratives")}
          </h2>
          <Chip tone={narratives.complete ? "ok" : "neutral"}>
            {t("common.ofSpokenFor", {
              spoken: narratives.spoken,
              total: narratives.total,
            })}
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">
        {narratives.objectives.length === 0 ? (
          <p className="text-sm text-ink-3">
            {t("session.detail.narratives.noOpenObjectivesIn")}
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
              ? t("session.detail.narratives.everyObjectiveHasHadItsTurn")
              : t("session.detail.narratives.theMicMovesOn")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
