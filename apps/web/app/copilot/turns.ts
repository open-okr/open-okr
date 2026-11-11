/**
 * A conversation as turns: a question, the answer to it, and the cards it
 * made (plan 0.8.1 CP3, review F6).
 *
 * The panel drew every message and then every card of the thread in one block
 * after the last message, newest first, so in a conversation with two requests
 * the cards no longer sat beside the words that made them, and while a new
 * question was answered the old cards sat between it and its answer. A card is
 * made for a question, before its answer (plan 0.8.1 A2), so it belongs to the
 * last question asked before the card was.
 *
 * Pure, so the order is tested without a browser.
 */

/** What grouping needs of a message. */
export interface TurnMessage {
  readonly id: string;
  readonly role: "member" | "assistant";
  readonly createdAt: string;
}

/** What grouping needs of a card. */
export interface TurnProposal {
  readonly id: string;
  readonly createdAt: string;
}

export interface Turn<M extends TurnMessage, P extends TurnProposal> {
  /** Stable across re-reads: the question's id, or the answer's without one. */
  readonly key: string;
  readonly question: M | null;
  readonly answer: M | null;
  /** Oldest first, which is the order they were offered in. */
  readonly proposals: readonly P[];
}

const at = (value: string): number => Date.parse(value);

/**
 * The recorded messages as turns, and the cards made after the last of them.
 *
 * `afterLast` is what belongs to a question still being answered: a card
 * written after every recorded message can only be the one in flight's.
 * With nothing in flight they go to the last turn instead, which is where a
 * card made during a run that has since been recorded belongs.
 */
export function groupTurns<M extends TurnMessage, P extends TurnProposal>(
  messages: readonly M[],
  proposals: readonly P[],
  inFlight: boolean,
): {
  readonly turns: readonly Turn<M, P>[];
  readonly afterLast: readonly P[];
} {
  const turns: { key: string; question: M | null; answer: M | null }[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (message.role === "member") {
      turns.push({ key: message.id, question: message, answer: null });
    } else if (last && last.answer === null && last.question !== null) {
      last.answer = message;
    } else {
      // An answer with no question before it: never written today, and drawn
      // on its own rather than dropped.
      turns.push({ key: message.id, question: null, answer: message });
    }
  }

  const latest = messages.reduce(
    (most, message) => Math.max(most, at(message.createdAt)),
    Number.NEGATIVE_INFINITY,
  );
  const byTurn = turns.map(() => [] as P[]);
  const afterLast: P[] = [];
  const ordered = [...proposals].sort(
    (a, b) => at(a.createdAt) - at(b.createdAt) || a.id.localeCompare(b.id),
  );
  for (const proposal of ordered) {
    const made = at(proposal.createdAt);
    if (inFlight && made > latest) {
      afterLast.push(proposal);
      continue;
    }
    // The last question asked at or before the card was made.
    let owner = -1;
    turns.forEach((turn, index) => {
      const asked = turn.question ?? turn.answer;
      if (asked && at(asked.createdAt) <= made) {
        owner = index;
      }
    });
    const target = owner === -1 ? 0 : owner;
    if (byTurn[target]) {
      byTurn[target].push(proposal);
    } else {
      afterLast.push(proposal);
    }
  }

  return {
    turns: turns.map((turn, index) => ({
      ...turn,
      proposals: byTurn[index] ?? [],
    })),
    afterLast,
  };
}
