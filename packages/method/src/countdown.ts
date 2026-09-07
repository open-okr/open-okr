/**
 * The per-cycle countdown and the weekly session lifecycle (METHOD.md §11,
 * AI-NATIVE-PLAN.md §6.2 and §6.4, P4-T05b).
 *
 * The Champion runs four cadences. The hourly one is the nudge queue and P4-T05a
 * built it. These are the other two clocks: the one that counts down to a
 * publication deadline and the one that opens and closes a weekly session.
 *
 * **Why this is in the method package and not in the scheduler.** Every value
 * these functions fire on is a §11 parameter, and §11's own rule is that
 * nothing numeric is hardcoded anywhere else. A scheduler holding its own copy
 * of "fourteen, seven and one" is how a threshold stops being the threshold.
 * They take a day count and return which trigger fires, with no clock, no rows
 * and no timezone: counting days in a workspace's calendar is P3-T06's job and
 * is already golden-master tested across both hemispheres' transitions.
 *
 * Every key returned here is a `triggers.ts` key. A message citing a key the
 * catalogue does not define fails the build, and these are the functions that
 * decide which key a day count earns.
 */
import type { ResolvedThresholds } from "./thresholds.ts";

const DAYS_PER_WEEK = 7;

/**
 * Whether planning opens today for a cycle starting this many days out.
 *
 * §11: six weeks before an annual cycle starts, three before a quarterly.
 * Exact rather than "at or within", because the caller runs once a local day
 * and a window would fire every day from six weeks out to day one. §6.4 calls
 * this one message, and one message is what it is.
 *
 * A cycle that has already started never opens planning. Planning that starts
 * in the cycle it plans is late, and a nudge saying so on day three is an
 * accusation rather than a reminder.
 */
export function planningOpensDue(
  daysUntilStart: number,
  mode: "annual" | "quarterly",
  thresholds: ResolvedThresholds,
): boolean {
  if (daysUntilStart <= 0) {
    return false;
  }
  const weeks = thresholds["cadence.planningOpenLeadWeeks"][mode];
  return daysUntilStart === weeks * DAYS_PER_WEEK;
}

/**
 * Which countdown milestone this many days before the deadline matches.
 *
 * Returns the number of days so the message can say it, or null on every other
 * day. §11 ships fourteen, seven and one; the days between them are silent, and
 * that silence is the point of naming three days rather than counting down
 * aloud from fourteen.
 *
 * On and after the deadline nothing fires. A countdown past zero is a different
 * message, and `cycle.phase_blocked` is the one that carries it.
 */
export function publicationCountdownMilestone(
  daysUntilDeadline: number,
  thresholds: ResolvedThresholds,
): number | null {
  if (daysUntilDeadline <= 0) {
    return null;
  }
  const days = thresholds["cadence.publicationCountdownDays"];
  return days.includes(daysUntilDeadline) ? daysUntilDeadline : null;
}

/**
 * Whether review preparation is due for a cycle ending this many days out.
 *
 * §11: two weeks before the cycle ends, "so scoring is prepared rather than
 * improvised in the room". Exact, for the same reason as the planning lead.
 */
export function reviewPreparationDue(
  daysUntilEnd: number,
  thresholds: ResolvedThresholds,
): boolean {
  if (daysUntilEnd <= 0) {
    return false;
  }
  return (
    daysUntilEnd ===
    thresholds["cadence.reviewPreparationLeadWeeks"] * DAYS_PER_WEEK
  );
}

/** Day one. §6.4's `cycle.starts`, which everybody hears exactly once. */
export function cycleStartsDue(daysUntilStart: number): boolean {
  return daysUntilStart === 0;
}

/**
 * Whether a cycle has ended without being closed.
 *
 * §6.4: "Cycle ends unscored". A cycle somebody has already closed owes nobody
 * a reminder to close it, and one that has not reached its end date has nothing
 * to close yet. `closing` still counts: the facilitator opened the close and
 * has not finished it, which is exactly the state the message is for.
 *
 * No threshold here on purpose. The condition is the end date passing, and the
 * caller runs once a local day, so this repeats daily until somebody closes the
 * cycle. The nudge engine's deduplication window is what keeps that to one
 * message a day rather than one an hour.
 */
export function cycleClosingDue(
  daysPastEnd: number,
  status: "planning" | "active" | "closing" | "closed",
): boolean {
  if (daysPastEnd < 0 || status === "closed") {
    return false;
  }
  return status === "active" || status === "closing";
}

/** Which of §6.4's three session messages a scheduled session has earned. */
export type SessionLifecycleStage = "due_soon" | "open" | "missed";

/**
 * The weekly session lifecycle, from hours rather than days.
 *
 * Hours because a session is an appointment: "one day before" is a reminder the
 * evening before, and "at the scheduled start" is an hour rather than a date.
 * Positive hours are before the session, negative after it.
 *
 * **`missed` carries no threshold of its own, and that is deliberate.** §6.4
 * says the message arrives "1 day after missed session", and §11 has no
 * parameter for it. Rather than invent one, the condition is the plain fact: the
 * scheduled day has passed and nobody ever opened the session. The Champion's
 * daily run is what turns that fact into a message a day later, so the document
 * is satisfied without a threshold that no workspace could see or change.
 *
 * **`missed` is one day wide, not everything after it.** §6.4 says "1 day
 * after", and a state that stayed `missed` forever would nudge about a session
 * from March every day until somebody deleted the row. Last week's session is
 * history; what the coordinator needs is this week's.
 *
 * A session in any state but `scheduled` is silent. One that is running or
 * closed was held, however late, and a skipped one was a decision rather than a
 * lapse: telling a coordinator they missed a session they deliberately skipped
 * is how a product teaches people to switch it off.
 */
export function sessionLifecycleStage(
  hoursUntilScheduled: number,
  state: "scheduled" | "running" | "closed" | "skipped",
  thresholds: ResolvedThresholds,
): SessionLifecycleStage | null {
  if (state !== "scheduled") {
    return null;
  }
  const leadHours = thresholds["cadence.dueSoonLeadDays"] * 24;
  if (hoursUntilScheduled > leadHours) {
    return null;
  }
  if (hoursUntilScheduled > 0) {
    return "due_soon";
  }
  // Inside the hour it was due, this is still the opening message. A
  // facilitator nine minutes late has not skipped anything.
  if (hoursUntilScheduled > -24) {
    return "open";
  }
  // The day after, and only that day.
  return hoursUntilScheduled > -48 ? "missed" : null;
}
