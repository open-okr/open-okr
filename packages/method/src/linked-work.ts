/**
 * Linked work, and the divergence it exposes (TECHNICAL-PLAN.md §4.9, P5-T11).
 *
 * **The one question this file answers is whether finishing work moves a
 * number, and the answer is no.** §4.9's own words: "the ratio of completed to
 * total linked tasks is shown as a separate signal beside the measured
 * progress. It never silently replaces the measured value." So nothing here
 * returns a progress figure. It returns a count and a count, and a sentence
 * naming both when they disagree.
 *
 * That is not a technical preference. A team that measures activity instead of
 * outcomes has an OKR practice in name only, and a product that let a full board
 * turn a key result green would be teaching exactly that.
 *
 * **No new METHOD.md rule and no new §11 threshold.** The comparison is between
 * two facts the product already holds: every linked task is done, and the
 * measured value has not moved off its baseline. There is no band to tune and no
 * wording to choose, so nothing here changes practice. The message cites
 * `quality.divergence`, the rule §6.4 already defines, exactly as
 * `divergence.ts` does.
 *
 * Pure: no database, no clock, no framework.
 */

/** What a key result's linked work looks like, counted. */
export interface LinkedWork {
  readonly done: number;
  readonly total: number;
}

/**
 * The share of linked work that is finished, or null when there is none.
 *
 * Null rather than zero, and the difference matters on a screen: a key result
 * with no tasks behind it has not been planned, and one with ten unfinished
 * tasks has. Drawing both as 0% would say the same thing about two different
 * situations.
 */
export function linkedWorkShare(work: LinkedWork): number | null {
  if (work.total <= 0) {
    return null;
  }
  return work.done / work.total;
}

export interface LinkedWorkDivergenceInput {
  readonly keyResultTitle: string;
  readonly work: LinkedWork;
  /** The measured value, as stored. */
  readonly currentValue: number;
  /** Where the measure started. */
  readonly baselineValue: number;
}

export interface LinkedWorkDivergence {
  /** The one case this file reports. Kept as a field so a caller can switch. */
  readonly kind: "linked_work_complete_without_movement";
  readonly severity: "high" | "medium" | "low";
  /** One specific sentence naming both figures, as §5.3 requires. */
  readonly reason: string;
}

/**
 * The divergence §4.9 names, or null.
 *
 * **Both figures are in the sentence, because either alone is useless.** "The
 * work is done" invites a shrug and "the number has not moved" invites a
 * different one; together they are a question somebody has to answer, which is
 * what a coaching message is for.
 *
 * **Medium, not high.** A champion who reports a goal healthy while its own
 * progress contradicts them has said something untrue, which is `divergence.ts`'s
 * high case. This one is a team that did what they planned and did not get what
 * they wanted. That is worth a conversation and is not a false statement, and
 * grading it the same would make the high band mean less.
 *
 * Nothing is reported while any linked work is unfinished: a plan in progress is
 * not evidence of anything yet.
 */
export function linkedWorkDivergence(
  input: LinkedWorkDivergenceInput,
): LinkedWorkDivergence | null {
  const { work } = input;
  if (work.total <= 0 || work.done < work.total) {
    return null;
  }
  if (input.currentValue !== input.baselineValue) {
    return null;
  }
  return {
    kind: "linked_work_complete_without_movement",
    severity: "medium",
    reason: `"${input.keyResultTitle}" has ${work.done} of ${work.total} linked ${
      work.total === 1 ? "task" : "tasks"
    } complete and its measure is still at its baseline of ${input.baselineValue}. Finishing the work was the plan; moving the number was the point. Which is wrong, the plan or the measure?`,
  };
}
