"use client";

import type { ResolvedThresholds } from "@openokr/method";
/**
 * The confidence round panel (METHOD.md §7.2 step 1, P4-T07b).
 *
 * Renders inside the session screen when `stageKey === 'confidence'`. Each key
 * result gets a dial, a vote status, and a what-changed input. The facilitator
 * reveals votes and confirms the final confidence per KR.
 *
 * **Drawn from the server's state, not from a flag this component kept**
 * (completeness review M-03). The confirm form used to appear only after this
 * browser had cast a vote, so in a space with team voting off, where the
 * server refuses every vote, the facilitator could never confirm and step 1
 * could not finish. And a revealed round showed nobody the votes or the
 * average it had just revealed. Now:
 *
 * | Space | Before reveal | After reveal |
 * |---|---|---|
 * | Voting on | Each member votes; the count shows, the values do not | Every vote and the team average; the facilitator confirms, starting from the average |
 * | Voting off | The facilitator sets the dial and confirms | Not applicable |
 */
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
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
  readonly teamVoting: boolean;
  readonly votesCast: number;
  readonly revealed: boolean;
  readonly votes: readonly {
    readonly memberId: string;
    readonly confidence: number;
  }[];
  readonly average: number | null;
  readonly myVote: number | null;
}

interface ConfidenceRoundProps {
  readonly sessionId: string;
  readonly krStatuses: readonly KrConfidenceStatus[];
  readonly isFacilitator: boolean;
  /** The workspace's own §3.2 boundaries, which the dial's bands read. */
  readonly thresholds: ResolvedThresholds;
  /** Participants' names, for the revealed votes. */
  readonly names: Readonly<Record<string, string>>;
}

export function ConfidenceRound({
  sessionId,
  krStatuses,
  isFacilitator,
  thresholds,
  names,
}: ConfidenceRoundProps) {
  const { t } = useTranslations();
  const teamVoting = krStatuses[0]?.teamVoting ?? true;

  return (
    <Card>
      <CardHeader>
        {t("session.detail.confidenceRound.confidenceRound")}
      </CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-ink-2">
          {teamVoting
            ? t("session.detail.confidenceRound.scoreEachKeyResult")
            : t("session.detail.confidenceRound.votingOff")}
        </p>
        <div className="space-y-6">
          {krStatuses.map((kr) => (
            <KrVoteCard
              key={kr.keyResultId}
              sessionId={sessionId}
              kr={kr}
              isFacilitator={isFacilitator}
              thresholds={thresholds}
              names={names}
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
  thresholds,
  names,
}: {
  sessionId: string;
  kr: KrConfidenceStatus;
  isFacilitator: boolean;
  thresholds: ResolvedThresholds;
  names: Readonly<Record<string, string>>;
}) {
  const { t } = useTranslations();

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialValue, setDialValue] = useState(
    kr.confirmedConfidence ?? kr.average ?? kr.myVote ?? 0.5,
  );
  const [note, setNote] = useState(kr.whatChanged ?? "");

  const handleVote = useCallback(() => {
    startTransition(async () => {
      await castVoteAction(sessionId, kr.keyResultId, dialValue);
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
            {t("common.confirmed2", {
              confirmedConfidence: kr.confirmedConfidence?.toFixed(1) ?? "",
            })}
          </span>
        </div>
        {kr.whatChanged && (
          <p className="mt-1 text-xs text-ink-2">{kr.whatChanged}</p>
        )}
      </div>
    );
  }

  // The confirm form: straight away with voting off, after reveal with it on.
  const canConfirm = isFacilitator && (!kr.teamVoting || kr.revealed);
  // A dial for this reader to move: to vote, or to set the confirmed value.
  const showsDial =
    canConfirm || (kr.teamVoting && !kr.revealed && kr.myVote === null);

  return (
    <div className="rounded-lg border border-line p-4 space-y-3">
      <h4 className="text-sm font-medium text-ink">{kr.title}</h4>

      {kr.teamVoting && kr.revealed ? (
        <div className="space-y-1.5 rounded-md bg-raised p-2.5">
          <p className="text-xs font-semibold text-ink-2">
            {t("session.detail.confidenceRound.theRoomVoted")}
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
            {kr.votes.map((vote) => (
              <li key={vote.memberId}>
                {names[vote.memberId] ?? t("activity.aMember")}:{" "}
                {vote.confidence.toFixed(1)}
              </li>
            ))}
          </ul>
          {kr.average !== null ? (
            <p className="text-sm font-semibold text-ink">
              {t("session.detail.confidenceRound.teamAverage", {
                average: kr.average.toFixed(2),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {showsDial ? (
        <ConfidenceDial
          value={dialValue}
          onChange={setDialValue}
          disabled={isPending}
          thresholds={thresholds}
        />
      ) : null}

      {kr.teamVoting && !kr.revealed ? (
        kr.myVote === null ? (
          <Button
            type="button"
            variant="primary"
            onClick={handleVote}
            disabled={isPending}
          >
            {t("session.detail.confidenceRound.castVote")}
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-2">
              {t("session.detail.confidenceRound.voteCastWaitingFor")}{" "}
              {t("session.detail.confidenceRound.yourVote", {
                confidence: kr.myVote.toFixed(1),
              })}
            </p>
          </div>
        )
      ) : null}

      {kr.teamVoting && !kr.revealed ? (
        <p className="text-xs text-ink-3">
          {t("session.detail.confidenceRound.votesIn", {
            count: kr.votesCast,
          })}
        </p>
      ) : null}

      {isFacilitator && kr.teamVoting && !kr.revealed ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="default"
            onClick={handleReveal}
            disabled={isPending || kr.votesCast === 0}
          >
            {t("session.detail.confidenceRound.revealVotes")}
          </Button>
          <p className="text-xs text-ink-3">
            {t("session.detail.confidenceRound.revealWhenReady")}
          </p>
        </div>
      ) : null}

      {canConfirm ? (
        <div className="space-y-2 border-t border-line pt-3">
          <label
            htmlFor={`what-changed-${kr.keyResultId}`}
            className="block text-xs font-medium text-ink-2"
          >
            {t("session.detail.confidenceRound.whatChangedThisWeek")}
          </label>
          <input
            id={`what-changed-${kr.keyResultId}`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("common.factsNotFeelings")}
            className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            disabled={isPending}
          />
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={isPending || note.trim().length === 0}
          >
            {t("session.detail.confidenceRound.confirmConfidence")}
          </Button>
        </div>
      ) : !isFacilitator && (!kr.teamVoting || kr.revealed) ? (
        <p className="text-xs text-ink-3">
          {t("session.detail.confidenceRound.facilitatorConfirms")}
        </p>
      ) : null}
    </div>
  );
}
