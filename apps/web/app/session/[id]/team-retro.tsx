"use client";

/**
 * Stage five: the team retro (UIUX-PLAN.md S-24, METHOD.md §8.1 stage 5,
 * P4-T11a).
 *
 * Two columns, notes written into them, then dot voting.
 *
 * **The two columns are canon and the board never invents a third.** §8.1 words
 * the stage as "What worked, what did not", and the action refuses any other
 * column at the boundary, so this component renders the set it is given rather
 * than a list it keeps.
 *
 * **Anonymity is per note, not per session.** §8.1 asks for silent writing, and
 * a name changes what people write. One thing in a retro is usually harder to
 * say than the rest, so the choice belongs to the note.
 *
 * **The dot cap is the §11 parameter, and the screen never counts it out.**
 * `sessions.retro` returns how many dots the reader has left, because the same
 * number is what `sessions.castRetroVote` enforces and two places counting it is
 * one place to get it wrong.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  addRetroNoteAction,
  castRetroVoteAction,
  clusterRetroAction,
  removeRetroNoteAction,
} from "./actions";

interface RetroNote {
  readonly id: string;
  readonly text: string;
  readonly votes: number;
  readonly mine: boolean;
  readonly authorName: string | null;
}

/** §8.1's two columns. Canon structure, so the type carries it. */
type RetroColumnKey = "worked" | "didnt";

export interface TeamRetro {
  readonly columns: readonly {
    readonly columnKey: RetroColumnKey;
    readonly notes: readonly RetroNote[];
  }[];
  readonly dotsPerMember: number;
  readonly dotsSpent: number;
  readonly dotsLeft: number;
}

const COLUMN_TITLES: Record<RetroColumnKey, string> = {
  worked: "What worked",
  didnt: "What did not",
};

function NoteRow({
  sessionId,
  note,
  canVote,
  dotsLeft,
  onProblem,
}: {
  readonly sessionId: string;
  readonly note: RetroNote;
  readonly canVote: boolean;
  readonly dotsLeft: number;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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

  // Out of dots is not a reason to hide a note the reader already voted for:
  // taking one back is how they free a dot up.
  const canSpend = canVote && (note.mine || dotsLeft > 0);

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
      <span className="text-sm text-ink">{note.text}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-4">
          {note.authorName ?? "anonymous"}
        </span>
        <Chip tone={note.votes === 0 ? "neutral" : "ok"}>
          {note.votes} {note.votes === 1 ? "dot" : "dots"}
        </Chip>
        {canVote ? (
          <Button
            type="button"
            size="sm"
            variant={note.mine ? "ghost" : "default"}
            disabled={pending || !canSpend}
            onClick={() => run(() => castRetroVoteAction(sessionId, note.id))}
          >
            {note.mine ? "Take my dot back" : "Spend a dot"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => removeRetroNoteAction(sessionId, note.id))}
        >
          Remove
        </Button>
      </span>
    </li>
  );
}

function Column({
  sessionId,
  columnKey,
  notes,
  canWrite,
  canVote,
  dotsLeft,
  onProblem,
}: {
  readonly sessionId: string;
  readonly columnKey: RetroColumnKey;
  readonly notes: readonly RetroNote[];
  readonly canWrite: boolean;
  readonly canVote: boolean;
  readonly dotsLeft: number;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const add = useCallback(() => {
    onProblem(null);
    if (text.trim().length === 0) {
      onProblem("Write the note first.");
      return;
    }
    startTransition(async () => {
      try {
        await addRetroNoteAction(sessionId, columnKey, text.trim(), anonymous);
        setText("");
        router.refresh();
      } catch (error) {
        onProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [anonymous, columnKey, onProblem, router, sessionId, text]);

  return (
    // **A named group, not a bare div.** Both columns carry a note field and a
    // "without my name" checkbox, so without a name on the column those controls
    // are two identical targets: a screen reader reads the same label twice and
    // anything else has to guess by position.
    <fieldset
      aria-labelledby={`retro-column-${columnKey}`}
      className="flex min-w-0 flex-1 flex-col gap-2 border-0 p-0"
    >
      <span className="flex items-center gap-2">
        <h3
          id={`retro-column-${columnKey}`}
          className="flex-1 text-xs font-semibold text-ink-2"
        >
          {COLUMN_TITLES[columnKey] ?? columnKey}
        </h3>
        <Chip tone="neutral">{notes.length}</Chip>
      </span>

      {notes.length === 0 ? (
        <p className="text-xs text-ink-4">Nothing here yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              sessionId={sessionId}
              note={note}
              canVote={canVote}
              dotsLeft={dotsLeft}
              onProblem={onProblem}
            />
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1" htmlFor={`note-${columnKey}`}>
            <span className="sr-only">
              {COLUMN_TITLES[columnKey] ?? columnKey}
            </span>
            <textarea
              id={`note-${columnKey}`}
              rows={2}
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={text}
              disabled={pending}
              placeholder="One thing, in one line"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <span className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={add}>
              Add it
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              <input
                type="checkbox"
                checked={anonymous}
                disabled={pending}
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              Without my name
            </label>
          </span>
        </div>
      ) : null}
    </fieldset>
  );
}

export function TeamRetroPanel({
  sessionId,
  retro,
  canWrite,
  canVote,
  assistAvailable = false,
}: {
  readonly sessionId: string;
  readonly retro: TeamRetro;
  readonly canWrite: boolean;
  readonly canVote: boolean;
  /**
   * Whether a provider can group the notes (P4-T15c).
   *
   * False is the normal case and the board is unchanged by it. Themes are a lens
   * over the board before the dots are spent, and nothing is written: the notes
   * keep their columns and the vote is still per note.
   */
  readonly assistAvailable?: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [themes, setThemes] = useState<
    readonly { title: string; noteIds: readonly string[] }[] | null
  >(null);
  const [clustering, setClustering] = useState(false);

  /** The note text behind an id, so a theme can be read without the board. */
  const textOf = useCallback(
    (noteId: string): string =>
      retro.columns
        .flatMap((column) => column.notes)
        .find((note) => note.id === noteId)?.text ?? "",
    [retro.columns],
  );

  const cluster = useCallback(async () => {
    setClustering(true);
    setProblem(null);
    try {
      const clustered = await clusterRetroAction(sessionId);
      setThemes(clustered?.themes ?? null);
      if (!clustered || clustered.themes.length === 0) {
        setProblem("No themes came out of that. The board stands on its own.");
      }
    } catch {
      setProblem("The assist could not run. The board is unaffected.");
    } finally {
      setClustering(false);
    }
  }, [sessionId]);

  return (
    <Card role="region" aria-labelledby="team-retro-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="team-retro-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            Team retro
          </h2>
          <Chip tone={retro.dotsLeft === 0 ? "warn" : "neutral"}>
            {retro.dotsLeft} of {retro.dotsPerMember} dots left
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-col gap-4 sm:flex-row">
          {retro.columns.map((column) => (
            <Column
              key={column.columnKey}
              sessionId={sessionId}
              columnKey={column.columnKey}
              notes={column.notes}
              canWrite={canWrite}
              canVote={canVote}
              dotsLeft={retro.dotsLeft}
              onProblem={setProblem}
            />
          ))}
        </div>

        {themes ? (
          <section
            aria-label="Retro themes"
            className="rounded-md border border-line bg-surface p-3"
          >
            <span className="mb-2 flex items-center gap-2">
              <Chip tone="agent">AI</Chip>
              <span className="text-xs text-ink-4">
                A lens over the board. The vote is still per note.
              </span>
            </span>
            <ul className="flex flex-col gap-2">
              {themes.map((theme) => (
                <li key={theme.title}>
                  <p className="text-sm font-semibold text-ink">
                    {theme.title}
                  </p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {theme.noteIds.map((noteId) => (
                      <li key={noteId} className="text-xs text-ink-3">
                        {textOf(noteId)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {assistAvailable && themes === null ? (
          <span>
            <Button
              type="button"
              variant="ai"
              disabled={clustering}
              onClick={() => void cluster()}
            >
              Find the themes
            </Button>
          </span>
        ) : null}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        <p className="text-xs text-ink-4">
          {/* One dot per note is what makes the vote about spread rather than
              volume, so it is worth saying out loud on the screen. */}
          One dot per note, {retro.dotsPerMember} in total. Spending a second
          dot on the same note takes the first one back.
        </p>
      </CardBody>
    </Card>
  );
}
