"use client";

/**
 * Stage ten: learnings and next-cycle drafts. Stage eleven: decisions and
 * actions (UIUX-PLAN.md S-24, METHOD.md §8.9 and §8.1 stage 11, P4-T11c-b).
 *
 * One component for both, because the page renders it on whichever of the two
 * stages is running and the two halves are one flow: what we learned, what the
 * next cycle might carry, and who does what by when.
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
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  addActionAction,
  captureLearningAction,
  completeActionAction,
  draftNextCycleAction,
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const [learning, setLearning] = useState("");
  const [carry, setCarry] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftWhy, setDraftWhy] = useState("");
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
            error instanceof Error ? error.message : "That did not save.",
          );
        }
      });
    },
    [router],
  );

  return (
    <Card role="region" aria-labelledby="forward-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="forward-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            Learnings and what happens next
          </h2>
          <Chip tone="neutral">{forward.carried} carried</Chip>
          <Chip tone={forward.actions.length === 0 ? "warn" : "ok"}>
            {forward.actions.length}{" "}
            {forward.actions.length === 1 ? "action" : "actions"}
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">Learnings</h3>
          {forward.learnings.length === 0 ? (
            <p className="text-xs text-ink-4">
              Nothing captured yet. §8.9 asks for these as "we learned that…".
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
                    <Chip tone="info">from the retro</Chip>
                  ) : null}
                  {entry.carryForward ? <Chip tone="ok">carried</Chip> : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit && forward.promotable.length > 0 ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
              <span className="text-xs font-medium text-ink-3">
                Promote a retro theme, most voted first
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
                      {note.votes} {note.votes === 1 ? "dot" : "dots"}
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
                            `We learned that ${note.text}`,
                            true,
                            note.noteId,
                          ),
                        )
                      }
                    >
                      Promote it
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
                  What we now know
                </span>
                <input
                  id="learning-text"
                  type="text"
                  className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                  value={learning}
                  disabled={pending}
                  placeholder="We learned that…"
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
                      setProblem("Write the learning first.");
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
                  Capture it
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-ink-3">
                  <input
                    type="checkbox"
                    checked={carry}
                    disabled={pending}
                    onChange={(event) => setCarry(event.target.checked)}
                  />
                  Carry it into the next cycle
                </label>
              </span>
              <p className="text-xs text-ink-4">
                A carried item re-enters the next cycle as an issue. It has to
                survive prioritisation on its merits.
              </p>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">
            Next-cycle drafts
          </h3>
          {forward.drafts.length === 0 ? (
            <p className="text-xs text-ink-4">Nothing drafted yet.</p>
          ) : (
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
          )}

          {canEdit ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1" htmlFor="draft-title">
                <span className="text-xs font-medium text-ink-3">
                  A candidate objective
                </span>
                <input
                  id="draft-title"
                  type="text"
                  className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                  value={draftTitle}
                  disabled={pending}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1" htmlFor="draft-why">
                <span className="text-xs font-medium text-ink-3">Why</span>
                <input
                  id="draft-why"
                  type="text"
                  className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                  value={draftWhy}
                  disabled={pending}
                  placeholder="What in this cycle makes the case"
                  onChange={(event) => setDraftWhy(event.target.value)}
                />
              </label>
              <span>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (
                      draftTitle.trim().length === 0 ||
                      draftWhy.trim().length === 0
                    ) {
                      setProblem(
                        "A draft needs a title and a why. Without the why the next cycle cannot prioritise it.",
                      );
                      return;
                    }
                    run(async () => {
                      await draftNextCycleAction(
                        sessionId,
                        draftTitle.trim(),
                        draftWhy.trim(),
                      );
                      setDraftTitle("");
                      setDraftWhy("");
                    });
                  }}
                >
                  Draft it
                </Button>
              </span>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-2">
            Decisions and actions
          </h3>
          {forward.actions.length === 0 ? (
            <p className="text-xs text-ink-4">
              Nothing agreed yet. Every action has a name and a date, or it is a
              wish.
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
                      {action.done ? "Reopen it" : "Done"}
                    </Button>
                  ) : (
                    <Chip tone={action.done ? "ok" : "warn"}>
                      {action.done ? "done" : "open"}
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
                  What happens
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
                  <span className="text-xs font-medium text-ink-3">Owner</span>
                  <select
                    id="action-owner"
                    className="rounded-md border border-line bg-surface p-2 text-sm text-ink"
                    value={ownerId}
                    disabled={pending}
                    onChange={(event) => setOwnerId(event.target.value)}
                  >
                    {/* No default owner. An action assigned by the form is an
                        action nobody in the room accepted. */}
                    <option value="">Choose somebody</option>
                    {forward.owners.map((person) => (
                      <option key={person.memberId} value={person.memberId}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1" htmlFor="action-due">
                  <span className="text-xs font-medium text-ink-3">By</span>
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
                      setProblem("Say what happens.");
                      return;
                    }
                    if (ownerId === "" || dueOn === "") {
                      setProblem(
                        "Every action has a name and a date, or it is a wish.",
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
                  Agree it
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
