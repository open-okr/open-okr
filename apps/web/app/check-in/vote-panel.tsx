import { Button, Chip } from "@openokr/ui";
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

export function VotePanel({
  vote,
  canReveal,
}: {
  readonly vote: VoteState;
  readonly canReveal: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
      <div className="flex items-start justify-between gap-2.5">
        <span className="text-sm text-ink">{vote.title}</span>
        <Chip tone={vote.revealed ? "ok" : "neutral"}>
          {vote.revealed
            ? `revealed · average ${vote.average ?? 0}`
            : `${vote.count} vote${vote.count === 1 ? "" : "s"} in`}
        </Chip>
      </div>

      {vote.revealed ? (
        <p className="text-xs text-ink-2">
          {vote.votes.map((entry) => entry.confidence).join(", ")}
        </p>
      ) : (
        <p className="text-xs text-ink-3">
          {vote.own === null
            ? "You have not voted yet."
            : `Your vote: ${vote.own}`}
        </p>
      )}

      {vote.revealed ? null : (
        <ActionForm action={castVote} className="flex items-center gap-1.5">
          <input type="hidden" name="keyResultId" value={vote.keyResultId} />
          <label className="sr-only" htmlFor={`vote-${vote.keyResultId}`}>
            Your confidence in {vote.title}
          </label>
          <input
            id={`vote-${vote.keyResultId}`}
            name="confidence"
            type="range"
            min="0"
            max="1"
            step="0.1"
            defaultValue={vote.own ?? 0.5}
            className="w-32"
          />
          <Button type="submit" variant="ghost" className="h-7 px-2 text-xs">
            {vote.own === null ? "Vote" : "Change"}
          </Button>
        </ActionForm>
      )}

      {canReveal && !vote.revealed && vote.count > 0 ? (
        <ActionForm action={revealVotes}>
          <input type="hidden" name="keyResultId" value={vote.keyResultId} />
          <Button type="submit" variant="ghost" className="h-7 px-2 text-xs">
            Reveal together
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
