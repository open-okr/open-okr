"use client";

/**
 * Stage seven: root causes (UIUX-PLAN.md S-24, METHOD.md §8.4, P4-T11b).
 *
 * Every key result the room graded below the threshold gets exactly one primary
 * cause, and a detail line for the "ask why until it stops being a symptom" part.
 *
 * **The eight causes and the threshold both come from the read.** The taxonomy
 * is canon in `packages/method` and `scoring.rootCauseThreshold` is a §11
 * parameter, so nothing here states either: a screen with its own copy of a
 * taxonomy is a screen that will disagree with the method eventually.
 *
 * **No cause is pre-selected.** §8.4 asks a room to look for the system rather
 * than the person, and a picker that arrives with an answer in it is a room
 * confirming rather than diagnosing. Same reason the monthly trend buttons start
 * empty (P4-T09).
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { setRootCauseAction } from "./actions";

interface MissedKeyResult {
  readonly keyResultId: string;
  readonly title: string;
  readonly goalTitle: string;
  readonly score: number;
  readonly causeKey: number | null;
  readonly causeLabel: string | null;
  readonly detail: string | null;
}

export interface RootCauses {
  readonly threshold: number;
  readonly keyResults: readonly MissedKeyResult[];
  readonly named: number;
  readonly complete: boolean;
  /** §8.4's eight, in the document's order, from `packages/method`. */
  readonly causes: readonly string[];
}

function MissedRow({
  sessionId,
  keyResult,
  causes,
  canName,
  onProblem,
}: {
  readonly sessionId: string;
  readonly keyResult: MissedKeyResult;
  readonly causes: readonly string[];
  readonly canName: boolean;
  readonly onProblem: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<number | null>(keyResult.causeKey);
  const [detail, setDetail] = useState(keyResult.detail ?? "");

  const save = useCallback(
    (causeKey: number) => {
      onProblem(null);
      setChosen(causeKey);
      startTransition(async () => {
        try {
          await setRootCauseAction(
            sessionId,
            keyResult.keyResultId,
            causeKey,
            detail.trim(),
          );
          router.refresh();
        } catch (error) {
          onProblem(
            error instanceof Error ? error.message : "That did not save.",
          );
        }
      });
    },
    [detail, keyResult.keyResultId, onProblem, router, sessionId],
  );

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-2.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm text-ink">{keyResult.title}</span>
        <Chip tone="bad">{keyResult.score.toFixed(1)}</Chip>
        {keyResult.causeKey === null ? (
          <Chip tone="warn">no cause yet</Chip>
        ) : (
          <Chip tone="ok">named</Chip>
        )}
      </span>
      <span className="text-xs text-ink-4">{keyResult.goalTitle}</span>

      {canName ? (
        <>
          <span className="flex flex-wrap gap-1.5">
            {causes.map((cause, index) => {
              const causeKey = index + 1;
              return (
                <Button
                  key={cause}
                  type="button"
                  size="sm"
                  variant={chosen === causeKey ? "default" : "ghost"}
                  disabled={pending}
                  onClick={() => save(causeKey)}
                >
                  {cause}
                </Button>
              );
            })}
          </span>
          <label
            className="flex flex-col gap-1"
            htmlFor={`detail-${keyResult.keyResultId}`}
          >
            <span className="text-xs font-medium text-ink-3">
              Ask why until it stops being a symptom
            </span>
            <input
              id={`detail-${keyResult.keyResultId}`}
              type="text"
              className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
              value={detail}
              disabled={pending}
              placeholder="The system, not the person"
              onChange={(event) => setDetail(event.target.value)}
              onBlur={() => {
                // Saved with the cause rather than on its own, because a detail
                // with no cause behind it explains nothing.
                if (
                  chosen !== null &&
                  detail.trim() !== (keyResult.detail ?? "")
                ) {
                  save(chosen);
                }
              }}
            />
          </label>
        </>
      ) : keyResult.causeLabel === null ? null : (
        <span className="text-xs text-ink-3">
          {keyResult.causeLabel}
          {keyResult.detail ? ` — ${keyResult.detail}` : ""}
        </span>
      )}
    </li>
  );
}

export function RootCausePanel({
  sessionId,
  rootCauses,
  canName,
}: {
  readonly sessionId: string;
  readonly rootCauses: RootCauses;
  readonly canName: boolean;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Card role="region" aria-labelledby="root-cause-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="root-cause-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            Root cause
          </h2>
          <Chip tone={rootCauses.complete ? "ok" : "neutral"}>
            {rootCauses.named} of {rootCauses.keyResults.length} named
          </Chip>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">
        {rootCauses.keyResults.length === 0 ? (
          <p className="text-sm text-ink-3">
            {/* Two different empty states, and they mean opposite things. */}
            Nothing came in below {rootCauses.threshold.toFixed(1)}. Either the
            room has not graded yet, or nothing missed.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rootCauses.keyResults.map((keyResult) => (
              <MissedRow
                key={keyResult.keyResultId}
                sessionId={sessionId}
                keyResult={keyResult}
                causes={rootCauses.causes}
                canName={canName}
                onProblem={setProblem}
              />
            ))}
          </ul>
        )}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        {rootCauses.keyResults.length === 0 ? null : (
          <p className="text-xs text-ink-4">
            One primary cause each, below {rootCauses.threshold.toFixed(1)}.
            Look for the system, not the person.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
