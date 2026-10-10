import {
  Button,
  Chip,
  type ConfidenceDisplay,
  ConfidenceInput,
  formatConfidence,
} from "@openokr/ui";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "../cycle/action-form.tsx";
import { castVote, revealVotes } from "./actions.ts";

/**
 * One key result's confidence votes (METHOD.md §7.2 step four, design §6.6).
 *
 * The reveal is one write over the whole set, so there is no state in which a
 * client can see three of four numbers. Before it, the server sends the count and
 * the reader's own vote and nothing else, so privacy is not a rendering decision
 * this component could get wrong.
 */
export interface VoteState {
  readonly keyResultId: string;
  readonly title: string;
  readonly revealed: boolean;
  readonly count: number;
  readonly own: number | null;
  readonly average: number | null;
  readonly votes: readonly { memberId: string; confidence: number }[];
}

export async function VotePanel({
  vote,
  canReveal,
  display,
}: {
  readonly vote: VoteState;
  readonly canReveal: boolean;
  /** The workspace's "Confidence shown as" (guided-inputs §4.8). */
  readonly display: ConfidenceDisplay;
}) {
  const { t } = await getTranslations();
  const shown = (confidence: number) =>
    formatConfidence(confidence, display, t);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
      <div className="flex items-start justify-between gap-2.5">
        <span className="text-sm text-ink">{vote.title}</span>
        <Chip tone={vote.revealed ? "ok" : "neutral"}>
          {vote.revealed
            ? t("checkIn.votePanel.revealedAverage", {
                average: shown(vote.average ?? 0),
              })
            : t("checkIn.votePanel.votesIn", {
                votes:
                  vote.count === 1
                    ? t("common.count.voteOne", { count: vote.count })
                    : t("common.count.voteOther", { count: vote.count }),
              })}
        </Chip>
      </div>

      {vote.revealed ? (
        <p className="text-xs text-ink-2">
          {vote.votes.map((entry) => shown(entry.confidence)).join(", ")}
        </p>
      ) : (
        <p className="text-xs text-ink-3">
          {vote.own === null
            ? t("checkIn.votePanel.youHaveNotVotedYet")
            : t("checkIn.votePanel.yourVote", { vote: shown(vote.own) })}
        </p>
      )}

      {vote.revealed ? null : (
        <ActionForm action={castVote} className="flex items-center gap-1.5">
          <input type="hidden" name="keyResultId" value={vote.keyResultId} />
          {/* The slider this replaces never showed its value. */}
          <ConfidenceInput
            id={`vote-${vote.keyResultId}`}
            label={t("checkIn.votePanel.yourConfidenceIn", {
              title: vote.title,
            })}
            hideLabel
            name="confidence"
            defaultValue={vote.own ?? 0.5}
            display={display}
          />
          <Button type="submit" variant="ghost" className="h-7 px-2 text-xs">
            {vote.own === null
              ? t("checkIn.votePanel.vote")
              : t("checkIn.votePanel.change")}
          </Button>
        </ActionForm>
      )}

      {canReveal && !vote.revealed && vote.count > 0 ? (
        <ActionForm action={revealVotes}>
          <input type="hidden" name="keyResultId" value={vote.keyResultId} />
          <Button type="submit" variant="ghost" className="h-7 px-2 text-xs">
            {t("checkIn.votePanel.revealTogether")}
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
