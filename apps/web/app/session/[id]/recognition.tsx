"use client";

/**
 * Stage four: recognition and wins (UIUX-PLAN.md S-24, METHOD.md §8.1 stage 4,
 * P4-T10c).
 *
 * "Name the effort that deserved to be seen. Specific beats generous."
 *
 * **Anybody in the room may give it.** §8.1 asks the room to name what it saw,
 * so recognition handed out by the facilitator alone would be a different ritual
 * with the same name. The action refuses only two things: recognising yourself,
 * and an empty line.
 *
 * **Nothing here aggregates.** Two entries for the same person are two things
 * they did, and collapsing them to a count would turn recognition into a
 * leaderboard, which is the opposite of specific.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { giveKudosAction } from "./actions";

export interface Recognition {
  readonly entries: readonly {
    readonly id: string;
    readonly fromName: string;
    readonly toName: string;
    readonly text: string;
    readonly mine: boolean;
  }[];
  /** Everybody in the room except the reader, who cannot be the recipient. */
  readonly recipients: readonly {
    readonly memberId: string;
    readonly name: string;
  }[];
}

export function RecognitionPanel({
  sessionId,
  recognition,
  canGive,
}: {
  readonly sessionId: string;
  readonly recognition: Recognition;
  readonly canGive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [toMemberId, setToMemberId] = useState("");
  const [text, setText] = useState("");

  const submit = useCallback(() => {
    setProblem(null);
    if (toMemberId === "") {
      setProblem("Choose who you are naming first.");
      return;
    }
    if (text.trim().length === 0) {
      setProblem("Say what they did. Specific beats generous.");
      return;
    }
    startTransition(async () => {
      try {
        await giveKudosAction(sessionId, toMemberId, text.trim());
        setText("");
        setToMemberId("");
        router.refresh();
      } catch (error) {
        setProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [router, sessionId, text, toMemberId]);

  return (
    // Named landmark, for the reason the narratives panel carries one.
    <Card role="region" aria-labelledby="recognition-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="recognition-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            Recognition and wins
          </h2>
          <Chip tone={recognition.entries.length === 0 ? "neutral" : "ok"}>
            {recognition.entries.length} named
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {recognition.entries.length === 0 ? (
          <p className="text-sm text-ink-3">
            Nobody has been named yet. Three minutes, and specific beats
            generous.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recognition.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 rounded-md border border-line p-2.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {entry.toName}
                  </span>
                  <span className="text-xs text-ink-4">
                    named by {entry.fromName}
                  </span>
                  {entry.mine ? <Chip tone="info">yours</Chip> : null}
                </span>
                <span className="text-sm text-ink-2">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}

        {canGive && recognition.recipients.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
            <label className="flex flex-col gap-1" htmlFor="kudos-to">
              <span className="text-xs font-medium text-ink-3">Who</span>
              <select
                id="kudos-to"
                className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={toMemberId}
                disabled={pending}
                onChange={(event) => setToMemberId(event.target.value)}
              >
                {/* No default selection. A pre-picked name is a name the room
                    did not choose. */}
                <option value="">Choose somebody</option>
                {recognition.recipients.map((person) => (
                  <option key={person.memberId} value={person.memberId}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor="kudos-text">
              <span className="text-xs font-medium text-ink-3">
                What they did
              </span>
              <input
                id="kudos-text"
                type="text"
                className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={text}
                disabled={pending}
                placeholder="Specific beats generous"
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <span>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={submit}
              >
                Name it
              </Button>
            </span>
          </div>
        ) : null}

        {canGive && recognition.recipients.length === 0 ? (
          <p className="text-xs text-ink-4">
            {/* Not an error state. A workspace of one has nobody else to name,
                and recognising yourself is refused by the action. */}
            There is nobody else in the workspace to name yet.
          </p>
        ) : null}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}
      </CardBody>
    </Card>
  );
}
