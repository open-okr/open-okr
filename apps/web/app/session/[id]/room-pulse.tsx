"use client";

/**
 * Stage one's own content (UIUX-PLAN.md S-24, METHOD.md §8.2, P4-T10a-b).
 *
 * Two halves that deliberately do not match. Everybody gives a pulse and one
 * word. Only the facilitator sees what the room averaged, and §8.2's sentence
 * for that band.
 *
 * **The asymmetry is practice, not permission.** §8.2 shows the average "to the
 * facilitator with interpretation". A room that can see its own average before
 * scoring has been handed an anchor, which is the failure §8.3's hidden
 * objective score exists to prevent. The action refuses the read to anybody
 * else, so this component is not the thing keeping the secret.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { givePulseAction } from "./actions";

const PULSES = [1, 2, 3, 4, 5] as const;

const BAND_TONE: Record<string, "ok" | "warn" | "bad"> = {
  energetic: "ok",
  steady: "warn",
  costly: "bad",
};

export interface RoomPulse {
  readonly average: number | null;
  readonly band: string | null;
  readonly read: string | null;
  readonly given: number;
  readonly expected: number;
  readonly mine: {
    readonly pulse: number | null;
    readonly word: string | null;
  };
  readonly words: readonly { readonly word: string; readonly count: number }[];
}

export function RoomPulsePanel({
  sessionId,
  pulse,
  canGive,
}: {
  readonly sessionId: string;
  readonly pulse: RoomPulse;
  readonly canGive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(pulse.mine.pulse);
  const [word, setWord] = useState(pulse.mine.word ?? "");

  const submit = useCallback(() => {
    setProblem(null);
    if (chosen === null) {
      setProblem("Choose a number from one to five first.");
      return;
    }
    startTransition(async () => {
      try {
        await givePulseAction(sessionId, chosen, word.trim());
        router.refresh();
      } catch (error) {
        setProblem(
          error instanceof Error ? error.message : "That did not save.",
        );
      }
    });
  }, [chosen, router, sessionId, word]);

  // The facilitator gets the read; everybody else gets null from the action, so
  // the absence of a read is the answer rather than a permission check here.
  const hasRead = pulse.read !== null && pulse.average !== null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <span className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-ink">Your pulse</h2>
            <Chip tone="neutral">
              {pulse.given} of {pulse.expected} given
            </Chip>
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-xs text-ink-4">
            One to five for the cycle just gone, and one word. Before the
            numbers, the people.
          </p>
          <span className="flex flex-wrap gap-1.5">
            {PULSES.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={chosen === value ? "primary" : "default"}
                disabled={pending || !canGive}
                onClick={() => setChosen(value)}
              >
                {value}
              </Button>
            ))}
          </span>
          <label className="flex flex-col gap-1" htmlFor="pulse-word">
            <span className="text-xs font-medium text-ink-3">
              One word for the cycle
            </span>
            <input
              id="pulse-word"
              type="text"
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={word}
              disabled={!canGive}
              placeholder="relieved"
              onChange={(event) => setWord(event.target.value)}
            />
          </label>
          {canGive ? (
            <span className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={pending} onClick={submit}>
                {pulse.mine.pulse === null ? "Give my pulse" : "Change it"}
              </Button>
              {pulse.mine.pulse === null ? null : (
                <span className="text-xs text-ink-4">
                  Yours is recorded. Changing it corrects your own, and nobody
                  gets two voices.
                </span>
              )}
            </span>
          ) : null}
          {problem === null ? null : (
            <p className="text-sm text-bad">{problem}</p>
          )}
        </CardBody>
      </Card>

      {hasRead ? (
        <Card role="region" aria-labelledby="room-pulse-heading">
          <CardHeader>
            <span className="flex flex-wrap items-center gap-2">
              <h2
                id="room-pulse-heading"
                className="text-sm font-bold text-ink"
              >
                The room
              </h2>
              <Chip tone={BAND_TONE[pulse.band ?? ""] ?? "neutral"}>
                {/* One decimal, because §8.2's own bands are written to one. */}
                {pulse.average?.toFixed(1)} of 5
              </Chip>
              <Chip tone="neutral">yours to read</Chip>
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <p className="text-sm text-ink">{pulse.read}</p>
            {pulse.words.length === 0 ? null : (
              <span className="flex flex-wrap gap-1.5">
                {pulse.words.map((given) => (
                  // Counted, not attributed. §8.2 asks for the room's mood, and
                  // a name beside a low word turns a check-in into something to
                  // answer for.
                  <Chip key={given.word} tone="neutral">
                    {given.word}
                    {given.count > 1 ? ` ${given.count}` : ""}
                  </Chip>
                ))}
              </span>
            )}
            <p className="text-xs text-ink-4">
              Only you see this. The room seeing its own average before scoring
              is an anchor, which is the thing the hidden objective score exists
              to avoid.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
