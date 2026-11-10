/**
 * Whether an alignment finding can be applied with one click (METHOD.md §5.3,
 * design `alignment-engine.md` §9, plan 0.7.0 A6).
 *
 * §5.3: "Where the fix is mechanical (relink, dependency), the finding offers
 * a one-click proposal for a person to accept." Only a relink is mechanical
 * here. Re-parenting is one column and the engine recomputes from it. A
 * dependency needs a provider named and a direction chosen (§5.4), which is a
 * decision rather than a click, and a conflict, a gap or a divergence has
 * nothing to apply at all.
 *
 * **Derived, never stored** (§9.2, D1). Every input is a column the finding
 * already has. A stored copy would have to be written by every writer of the
 * table, and the day one forgot, the button and the action would disagree.
 * `alignment.applyFinding`, `alignment.read` and the panel all ask this one
 * function instead, so a button the action would refuse cannot be drawn.
 *
 * Pure: no rows, no access. Whether *this* reader may apply it is the
 * action's question, asked against both goals when the click arrives.
 */

/** The four columns the answer reads. Strings, so a read's rows fit as they are. */
export interface OneClickFinding {
  readonly kind: string;
  readonly state: string;
  readonly subjectGoalId: string | null;
  readonly targetGoalId: string | null;
}

/**
 * Why a finding is not one click, first reason first.
 *
 * The kind comes before the state, because a conflict is never applicable
 * whatever its state, and "already decided" said of one would suggest an open
 * one could be.
 */
export type NotOneClick = "not_mechanical" | "decided" | "missing_goal";

export function notOneClickBecause(
  finding: OneClickFinding,
): NotOneClick | null {
  if (finding.kind !== "relink") {
    return "not_mechanical";
  }
  if (finding.state !== "open") {
    return "decided";
  }
  // A relink names the goal to move and the parent to move it under. The
  // Coach's review can name only the first, and a click with nowhere to move
  // the goal to is not a fix.
  if (!finding.subjectGoalId || !finding.targetGoalId) {
    return "missing_goal";
  }
  return null;
}

/** True for an open relink naming both goals, and for nothing else. */
export function oneClickApplicable<T extends OneClickFinding>(
  finding: T,
): finding is T & {
  readonly subjectGoalId: string;
  readonly targetGoalId: string;
} {
  return notOneClickBecause(finding) === null;
}
