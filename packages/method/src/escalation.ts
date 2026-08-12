/**
 * The check-in escalation ladder (METHOD.md §11, P3-T06).
 *
 * §11's own wording: "champion at due, champion again at one day overdue,
 * reviewer once the grace is exceeded, coordinator at seven days, sponsor at
 * fourteen. Widening rather than repeating is what makes an escalation mean
 * something."
 *
 * Targets accumulate rather than replace, because the champion keeps being asked
 * while the escalation widens. An escalation that dropped the champion at step 3
 * would be telling the one person who can act that it is no longer their problem.
 *
 * This computes the step. P4-T05 sends the nudges. Splitting it here means the
 * ladder is golden-master tested with no channel, no queue and no clock, and the
 * days it fires on stay §11 parameters rather than numbers in a scheduler.
 */
import type { ResolvedThresholds } from "./thresholds.ts";

/** The roles §11 names, in the order the ladder reaches them. */
export type EscalationRole =
  | "champion"
  | "reviewer"
  | "coordinator"
  | "sponsor";

export interface Escalation {
  /** 0 to 5, or null when nothing fires. */
  readonly step: number | null;
  readonly targets: readonly EscalationRole[];
}

const NOTHING: Escalation = { step: null, targets: [] };

/**
 * Which step fires for a goal this many days past its due date.
 *
 * Negative days are before the due date, and only the due-soon lead fires there.
 * The grace boundary is exclusive, matching §3.5: at exactly the grace limit the
 * goal is not yet outdated and the reviewer is not yet involved.
 *
 * Where a space has no coordinator the target resolves to the space manager
 * (TECHNICAL-PLAN §4.2). This returns the role; resolving a role to a member is
 * the caller's job, because the engine has no rows.
 */
export function escalation(
  daysPastDue: number,
  graceDays: number,
  thresholds: ResolvedThresholds,
): Escalation {
  const ladder = thresholds["cadence.checkInLadderDays"];
  const lead = thresholds["cadence.dueSoonLeadDays"];

  if (daysPastDue < 0) {
    // The due-soon nudge, and nothing earlier. A reminder a week out is noise.
    return daysPastDue === -lead ? { step: 0, targets: ["champion"] } : NOTHING;
  }

  if (daysPastDue >= ladder.sponsor) {
    return {
      step: 5,
      targets: ["champion", "reviewer", "coordinator", "sponsor"],
    };
  }
  if (daysPastDue >= ladder.coordinator) {
    return { step: 4, targets: ["champion", "reviewer", "coordinator"] };
  }
  if (daysPastDue > graceDays) {
    return { step: 3, targets: ["champion", "reviewer"] };
  }
  if (daysPastDue >= ladder.championRepeat) {
    return { step: 2, targets: ["champion"] };
  }
  return { step: 1, targets: ["champion"] };
}
