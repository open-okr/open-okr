"use client";

/**
 * The confidence round panel (METHOD.md §7.2 step 1, P4-T07b).
 *
 * Renders inside the session screen when `stageKey === 'confidence'`. Each key
 * result gets a dial, a vote status, and a what-changed input. The facilitator
 * reveals votes and confirms the final confidence per KR.
 */
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  castVoteAction,
  confirmConfidenceAction,
  revealVotesAction,
} from "./actions";
import { ConfidenceDial } from "./confidence-dial";

interface KrConfidenceStatus {
  readonly keyResultId: string;
  readonly title: string;
  readonly confirmed: boolean;
  readonly confirmedConfidence: number | null;
  readonly whatChanged: string | null;
}

interface Vote {
  readonly id: string;
  readonly memberId: string;
  readonly confidence: number;
  readonly revealedAt: string | null;
}

interface ConfidenceRoundProps {
  readonly sessionId: string;
  readonly krStatuses: readonly KrConfidenceStatus[];
  readonly isFacilitator: boolean;
}

export function ConfidenceRound({
  sessionId,
  krStatuses,
  isFacilitator,
}: ConfidenceRoundProps) {
  return (
    <Card>
      <CardHeader>Confidence round</CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-ink-2">
          Score each key result's confidence. Votes reveal together so nobody
          anchors on the champion.
        </p>
        <div className="space-y-6">
          {krStatuses.map((kr) => (
            <KrVoteCard
              key={kr.keyResultId}
              sessionId={sessionId}
              kr={kr}
              isFacilitator={isFacilitator}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function KrVoteCard({
  sessionId,
  kr,
  isFacilitator,
}: {
  sessionId: string;
  kr: KrConfidenceStatus;
  isFacilitator: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialValue, setDialValue] = useState(kr.confirmedConfidence ?? 0.5);
  const [note, setNote] = useState(kr.whatChanged ?? "");
  const [voted, setVoted] = useState(false);

  const handleVote = useCallback(() => {
    startTransition(async () => {
      await castVoteAction(sessionId, kr.keyResultId, dialValue);
      setVoted(true);
      router.refresh();
    });
  }, [sessionId, kr.keyResultId, dialValue, router]);

  const handleReveal = useCallback(() => {
    startTransition(async () => {
      await revealVotesAction(sessionId, kr.keyResultId);
      router.refresh();
    });
  }, [sessionId, kr.keyResultId, router]);

  const handleConfirm = useCallback(() => {
    if (note.trim().length === 0) return;
    startTransition(async () => {
      await confirmConfidenceAction(sessionId, kr.keyResultId, dialValue, note);
      router.refresh();
    });
  }, [sessionId, kr.keyResultId, dialValue, note, router]);

  if (kr.confirmed) {
    return (
      <div className="rounded-lg border border-line p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-ink">{kr.title}</h4>
          <span className="text-sm font-semibold text-good">
            {kr.confirmedConfidence?.toFixed(1)} confirmed
          </span>
        </div>
        {kr.whatChanged && (
          <p className="mt-1 text-xs text-ink-2">{kr.whatChanged}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line p-4 space-y-3">
      <h4 className="text-sm font-medium text-ink">{kr.title}</h4>

      <ConfidenceDial
        value={dialValue}
        onChange={setDialValue}
        disabled={isPending}
      />

      {!voted ? (
        <Button
          type="button"
          variant="primary"
          onClick={handleVote}
          disabled={isPending}
        >
          Cast vote
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink-2">Vote cast. Waiting for reveal.</p>
          {isFacilitator && (
            <Button
              type="button"
              variant="default"
              onClick={handleReveal}
              disabled={isPending}
            >
              Reveal votes
            </Button>
          )}
        </div>
      )}

      {/* After reveal: the confirm form */}
      {isFacilitator && voted && (
        <div className="space-y-2 border-t border-line pt-3">
          <label
            htmlFor={`what-changed-${kr.keyResultId}`}
            className="block text-xs font-medium text-ink-2"
          >
            What changed this week (required)
          </label>
          <input
            id={`what-changed-${kr.keyResultId}`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Facts, not feelings"
            className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            disabled={isPending}
          />
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={isPending || note.trim().length === 0}
          >
            Confirm confidence
          </Button>
        </div>
      )}
    </div>
  );
}
