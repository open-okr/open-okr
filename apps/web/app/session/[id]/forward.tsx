"use client";

/**
 * Stage ten: learnings. Stage eleven: decisions and actions (UIUX-PLAN.md
 * S-24, METHOD.md §8.9 and §8.1 stage 11, P4-T11c-b).
 *
 * One component for both, because the page renders it on whichever of the two
 * stages is running and the two halves are one flow: what we learned, what the
 * next cycle might carry, and who does what by when.
 *
 * **The review drafts nothing for the next cycle** (P9-T22d). Stage ten was
 * "Learnings and next drafts", and the method review found it contradicting
 * §8.10's own rule: grade and hold the review before drafting, because drafting
 * pressure distorts honest scoring. The drafts it collected also went nowhere
 * but the minutes. A kept or modified objective now reaches the next cycle's
 * Phase 4 as a draft on its own, and an idea reaches its issue list as a
 * learning marked to carry, so the composer and the assist that filled it are
 * gone. A draft written before is still shown, read-only, because it is part of
 * the record.
 *
 * **Carry forward is off by default.** §8.9's own rule is that carried work
 * re-enters the next cycle as an issue and has to survive prioritisation on its
 * merits. A checkbox that arrives ticked is the free pass that section refuses.
 *
 * **The promotable themes arrive most-voted first.** §8.9 promotes the top
 * dot-voted themes, so the stage shows the board's verdict rather than asking the
 * room to remember it. A promoted note leaves the list because the learning it
 * became is in the list above, not because it is unavailable.
 *
 * **An action needs an owner and a date, and the form will not submit without
 * both.** §8.1 stage 11: every action has a name and a date, or it is a wish.
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
import {
  addActionAction,
  captureLearningAction,
  completeActionAction,
} from "./actions";

export interface Forward {
  readonly learnings: readonly {
    readonly id: string;
    readonly text: string;
    readonly carryForward: boolean;
    readonly source: string;
    readonly authorName: string | null;
  }[];
  readonly promotable: readonly {
    readonly noteId: string;
    readonly text: string;
    readonly votes: number;
  }[];
  readonly drafts: readonly {
    readonly id: string;
    readonly title: string;
    readonly why: string;
    readonly promoted: boolean;
  }[];
  readonly actions: readonly {
    readonly id: string;
    readonly what: string;
    readonly ownerName: string;
    readonly dueOn: string;
    readonly done: boolean;
  }[];
  readonly owners: readonly {
    readonly memberId: string;
    readonly name: string;
  }[];
  readonly carried: number;
}

export function ForwardPanel({
  sessionId,
  forward,
  canEdit,
}: {
  readonly sessionId: string;
  readonly forward: Forward;
  readonly canEdit: boolean;
}) {
  const { t } = useTranslations();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const [learning, setLearning] = useState("");
  const [carry, setCarry] = useState(false);
  const [what, setWhat] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueOn, setDueOn] = useState("");

  const run = useCallback(
    (work: () => Promise<unknown>) => {
      setProblem(null);
      startTransition(async () => {
        try {
          await work();
          router.refresh();
        } catch (error) {
          setProblem(
            error instanceof Error
              ? error.message
              : t("session.detail.thatDidNotSave"),
          );
        }
      });
    },
    [router, t],
  );

  return (
    <Card role="region" aria-labelledby="forward-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="forward-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            {t("session.detail.forward.learningsAndWhatHappens")}
          </h2>
          <Chip tone="neutral">
            {t("common.carried2", { carried: forward.carried })}
          </Chip>
          <Chip tone={forward.actions.length === 0 ? "warn" : "ok"}>
            {forward.actions.length === 1
              ? t("session.detail.forward.actionCountOne", {
                  count: forward.actions.length,
                })
              : t("session.detail.forward.actionCountOther", {
                  count: forward.actions.length,
                })}
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">
            {t("common.learnings")}
          </h3>
          {forward.learnings.length === 0 ? (
            <p className="text-xs text-ink-4">
              {t("session.detail.forward.nothingCapturedYet")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {forward.learnings.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2"
                >
                  <span className="flex-1 text-sm text-ink">{entry.text}</span>
                  {entry.source === "retro_theme" ? (
                    <Chip tone="info">
                      {t("session.detail.forward.fromTheRetro")}
                    </Chip>
                  ) : null}
                  {entry.carryForward ? (
                    <Chip tone="ok">{t("common.carried")}</Chip>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit && forward.promotable.length > 0 ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
              <span className="text-xs font-medium text-ink-3">
                {t("session.detail.forward.promoteARetroTheme")}
              </span>
              <ul className="flex flex-col gap-1.5">
                {forward.promotable.slice(0, 5).map((note) => (
                  <li
                    key={note.noteId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="flex-1 text-sm text-ink-2">
                      {note.text}
                    </span>
                    <Chip tone={note.votes === 0 ? "neutral" : "ok"}>
                      {note.votes === 1
                        ? t("session.detail.dotCountOne", {
                            count: note.votes,
                          })
                        : t("session.detail.dotCountOther", {
                            count: note.votes,
                          })}
                    </Chip>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          captureLearningAction(
                            sessionId,
                            t("session.detail.forward.weLearnedThatNote", {
                              text: note.text,
                            }),
                            true,
                            note.noteId,
                          ),
                        )
                      }
                    >
                      {t("session.detail.forward.promoteIt")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1" htmlFor="learning-text">
                <span className="text-xs font-medium text-ink-3">
                  {t("session.detail.forward.whatWeNowKnow")}
                </span>
                <input
                  id="learning-text"
                  type="text"
                  className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                  value={learning}
                  disabled={pending}
                  placeholder={t("session.detail.forward.weLearnedThat")}
                  onChange={(event) => setLearning(event.target.value)}
                />
              </label>
              <span className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (learning.trim().length === 0) {
                      setProblem(
                        t("session.detail.forward.writeTheLearningFirst"),
                      );
                      return;
                    }
                    run(async () => {
                      await captureLearningAction(
                        sessionId,
                        learning.trim(),
                        carry,
                      );
                      setLearning("");
                      setCarry(false);
                    });
                  }}
                >
                  {t("session.detail.forward.captureIt")}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-ink-3">
                  <input
                    type="checkbox"
                    checked={carry}
                    disabled={pending}
                    onChange={(event) => setCarry(event.target.checked)}
                  />
                  {t("session.detail.forward.carryItIntoThe")}
                </label>
              </span>
              <p className="text-xs text-ink-4">
                {t("session.detail.forward.aCarriedItemRe")}
              </p>
              <p className="text-xs text-ink-4">
                {t("session.detail.forward.anIdeaForTheNextCycle")}
              </p>
            </div>
          ) : null}
        </section>

        {forward.drafts.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-ink-2">
              {t("common.nextCycleDrafts")}
            </h3>
            <p className="text-xs text-ink-4">
              {t("session.detail.forward.draftsWrittenBefore")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {forward.drafts.map((draft) => (
                <li
                  key={draft.id}
                  className="flex flex-col gap-0.5 rounded-md border border-line p-2"
                >
                  <span className="text-sm text-ink">{draft.title}</span>
                  <span className="text-xs text-ink-3">{draft.why}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">
            {t("session.detail.forward.decisionsAndActions")}
          </h3>
          {forward.actions.length === 0 ? (
            <p className="text-xs text-ink-4">
              {t("session.detail.forward.nothingAgreedYetEvery")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {forward.actions.map((action) => (
                <li
                  key={action.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2"
                >
                  <span className="flex-1 text-sm text-ink">{action.what}</span>
                  <Chip tone="neutral">{action.ownerName}</Chip>
                  <Chip tone="neutral">{action.dueOn}</Chip>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={action.done ? "ghost" : "default"}
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          completeActionAction(
                            sessionId,
                            action.id,
                            !action.done,
                          ),
                        )
                      }
                    >
                      {action.done
                        ? t("session.detail.forward.reopenIt")
                        : t("board.done")}
                    </Button>
                  ) : (
                    <Chip tone={action.done ? "ok" : "warn"}>
                      {action.done
                        ? t("session.detail.done")
                        : t("common.open")}
                    </Chip>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && forward.owners.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1" htmlFor="action-what">
                <span className="text-xs font-medium text-ink-3">
                  {t("common.whatHappens")}
                </span>
                <input
                  id="action-what"
                  type="text"
                  className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                  value={what}
                  disabled={pending}
                  onChange={(event) => setWhat(event.target.value)}
                />
              </label>
              <span className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1" htmlFor="action-owner">
                  <span className="text-xs font-medium text-ink-3">
                    {t("common.owner")}
                  </span>
                  <select
                    id="action-owner"
                    className="rounded-md border border-line bg-surface p-2 text-sm text-ink"
                    value={ownerId}
                    disabled={pending}
                    onChange={(event) => setOwnerId(event.target.value)}
                  >
                    {/* No default owner. An action assigned by the form is an
                        action nobody in the room accepted. */}
                    <option value="">{t("common.chooseSomebody")}</option>
                    {forward.owners.map((person) => (
                      <option key={person.memberId} value={person.memberId}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1" htmlFor="action-due">
                  <span className="text-xs font-medium text-ink-3">
                    {t("session.detail.forward.by")}
                  </span>
                  <input
                    id="action-due"
                    type="date"
                    className="rounded-md border border-line bg-surface p-2 text-sm text-ink"
                    value={dueOn}
                    disabled={pending}
                    onChange={(event) => setDueOn(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (what.trim().length === 0) {
                      setProblem(t("session.detail.forward.sayWhatHappens"));
                      return;
                    }
                    if (ownerId === "" || dueOn === "") {
                      setProblem(
                        t("session.detail.forward.everyActionHasANameAndADate"),
                      );
                      return;
                    }
                    run(async () => {
                      await addActionAction(
                        sessionId,
                        what.trim(),
                        ownerId,
                        dueOn,
                      );
                      setWhat("");
                      setOwnerId("");
                      setDueOn("");
                    });
                  }}
                >
                  {t("session.detail.forward.agreeIt")}
                </Button>
              </span>
            </div>
          ) : null}
        </section>

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}
      </CardBody>
    </Card>
  );
}
