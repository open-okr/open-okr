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

/**
 * The acknowledgement ladder (METHOD.md §11, P4-T04c).
 *
 * §11's wording: "reviewer nudged one day after publication, escalated at
 * three". A check-in nobody acknowledged is a loop left open, and the person
 * who left it open is the reviewer rather than the champion who wrote it.
 *
 * The champion is never on this ladder. They did their part; chasing them for
 * somebody else's acknowledgement is how a product teaches people that its
 * messages are not about them.
 */
export function acknowledgementEscalation(
  daysSincePublication: number,
  thresholds: ResolvedThresholds,
): Escalation {
  const ladder = thresholds["cadence.acknowledgementLadderDays"];

  if (daysSincePublication >= ladder.escalate) {
    // Widened past the reviewer, so §6.3 treats it as urgent.
    return { step: 2, targets: ["reviewer", "coordinator"] };
  }
  if (daysSincePublication >= ladder.nudge) {
    return { step: 1, targets: ["reviewer"] };
  }
  return NOTHING;
}

/**
 * Where a blocker stands against the check-in its next action is due by
 * (METHOD.md §7.3, P9-T19a-a), in whole days of the workspace calendar.
 */
export interface BlockerClock {
  /**
   * Days from today to that check-in: 1 the day before it, 0 on it, and
   * negative once it has passed with the action open.
   */
  readonly daysUntilDue: number;
  /** Whether the check-in after that one has passed as well. */
  readonly followingPassed: boolean;
}

/**
 * The blocker ladder (METHOD.md §11, §7.3, P9-T19a-a).
 *
 * §11's wording: "owner reminded 1 day before the next check-in, coordinator
 * when the check-in passes with the action open". The clock is the check-in,
 * not a number of hours: a blocker raised on Tuesday in a weekly rhythm has
 * until next Tuesday, and nobody hears about it on Thursday.
 *
 * The sponsor is a rung only where the workspace puts the sponsor in its
 * ladders (§12, "Sponsor in escalation ladders"), and then once the check-in
 * after that one has passed too, so a sponsor hears about a blocker that has
 * outlived two of the team's own check-ins and never about one that has not.
 */
export function blockerEscalation(
  clock: BlockerClock,
  thresholds: ResolvedThresholds,
  sponsorInLadders: boolean,
): Escalation {
  const ladder = thresholds["cadence.blockerLadderDays"];

  if (clock.daysUntilDue < 0) {
    if (sponsorInLadders && clock.followingPassed) {
      return { step: 3, targets: ["champion", "coordinator", "sponsor"] };
    }
    return { step: 2, targets: ["champion", "coordinator"] };
  }
  if (clock.daysUntilDue <= ladder.reminder) {
    // The reminder, before the check-in rather than after it. The owner of a
    // blocker is its named owner, which the caller resolves; the role here is
    // the champion's position on the ladder.
    return { step: 1, targets: ["champion"] };
  }
  return NOTHING;
}
