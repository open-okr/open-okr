/**
 * What a member owes right now (UIUX-PLAN.md §4 S-02, P3-T08).
 *
 * Grouping and labelling only. No database, no rules of its own: every threshold
 * it reads arrives as an argument from the METHOD.md §11 registry, and the rows
 * arrive from the action beside it. Keeping it separate is what lets the same
 * words appear on the screen, in the sidebar badge and, at P4-T05, in a nudge,
 * without three places inventing three phrasings for the same fact.
 *
 * **An obligation is computed, never stored.** There is no `obligations` table
 * and there must not be one: an obligation is a question asked of the rows that
 * already exist (a goal past its due date, a published check-in nobody has
 * acknowledged), and a stored copy would be a second source of truth that goes
 * stale the moment somebody publishes. This is the same choice §2.3 makes for
 * phase completion.
 */

/**
 * Where an obligation comes from. Two are real today; four are declared and
 * empty.
 *
 * Not exported: every consumer so far reads the kind off an `Obligation` or
 * compares it to a literal, and an exported name nobody imports is a promise the
 * dead-code gate is right to refuse.
 */
type ObligationKind =
  | "check_in"
  | "acknowledgement"
  | "blocker"
  | "commitment"
  | "session"
  | "proposal";

/** S-02's four buckets, in the order the screen renders them. */
export type ObligationGroup = "overdue" | "today" | "this_week" | "upcoming";

export interface Obligation {
  /** Stable across reads, so a list can be keyed and an action can be aimed. */
  readonly id: string;
  readonly kind: ObligationKind;
  readonly group: ObligationGroup;
  readonly title: string;
  /** The quiet second line: role, cadence, space, whatever names the context. */
  readonly meta: string;
  /** "Overdue by 4 days", "Today", "Friday". */
  readonly dueLabel: string;
  /** The local date this is measured against, or null where there is none. */
  readonly dueOn: string | null;
  readonly daysPastDue: number | null;
  readonly href: string;
  readonly actionLabel: string;
  /** The goal this is about. Every obligation kind so far hangs off one. */
  readonly subjectId: string;
  /** Set on an acknowledgement, so the row can act without a second lookup. */
  readonly checkInId: string | null;
}

/**
 * The sources S-02 lists that no phase has built yet.
 *
 * Declared rather than omitted on purpose. A screen that silently rendered two
 * of six sources would look complete while quietly failing to tell somebody
 * about a blocker they own, and nothing in the build would catch it. Naming the
 * task that fills each one turns a silent gap into a visible promise.
 */
export interface PendingSource {
  readonly kind: ObligationKind;
  readonly label: string;
  readonly task: string;
}

export const PENDING_SOURCES: readonly PendingSource[] = [
  { kind: "blocker", label: "Blockers you own", task: "P3-T09" },
  { kind: "commitment", label: "Commitments due", task: "P4-T07" },
  { kind: "session", label: "Sessions to run", task: "P4-T04" },
  {
    kind: "proposal",
    label: "Agent proposals awaiting your decision",
    task: "P4-T05",
  },
];

/** Days ahead that still count as "this week" rather than "upcoming". */
const THIS_WEEK_DAYS = 7;

/**
 * Which bucket a due date falls in.
 *
 * `daysPastDue` follows the cadence service: positive is overdue by that many
 * local days, zero is due today, negative is that many days away.
 */
export function groupFor(daysPastDue: number): ObligationGroup {
  if (daysPastDue > 0) {
    return "overdue";
  }
  if (daysPastDue === 0) {
    return "today";
  }
  return -daysPastDue <= THIS_WEEK_DAYS ? "this_week" : "upcoming";
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The weekday a `YYYY-MM-DD` local date falls on.
 *
 * Parsed as UTC deliberately. The string is already the date in the workspace
 * timezone, so reading it back in any other zone would be converting a date
 * that has no time to convert.
 */
function weekdayOf(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "Overdue by 4 days", "Today", "Tomorrow", "Friday", or the date itself. */
export function dueLabelFor(
  daysPastDue: number,
  localDate: string | null,
): string {
  if (daysPastDue > 0) {
    return `Overdue by ${plural(daysPastDue, "day")}`;
  }
  if (daysPastDue === 0) {
    return "Today";
  }
  if (daysPastDue === -1) {
    return "Tomorrow";
  }
  if (-daysPastDue <= THIS_WEEK_DAYS && localDate) {
    return weekdayOf(localDate);
  }
  return localDate ?? "";
}

/**
 * How an open acknowledgement is aged.
 *
 * The obligation exists from the moment the check-in is published, so its due
 * date is the publication date and nothing is invented to give it one. Whether
 * it reads as *late* comes from `cadence.acknowledgementLadderDays.escalate`,
 * the §11 parameter whose own reason says "a check-in nobody acknowledged is a
 * loop left open": before the escalation day it is owed today, on or after it,
 * it is overdue. No new threshold is introduced here, and none may be.
 */
export function acknowledgementGroup(
  daysSincePublication: number,
  escalateAfterDays: number,
): ObligationGroup {
  return daysSincePublication >= escalateAfterDays ? "overdue" : "today";
}

export function acknowledgementDueLabel(
  daysSincePublication: number,
  escalateAfterDays: number,
): string {
  return acknowledgementGroup(daysSincePublication, escalateAfterDays) ===
    "overdue"
    ? `Overdue by ${plural(daysSincePublication, "day")}`
    : "Today";
}

/** "published today", "published yesterday", "published 4 days ago". */
export function publishedAgo(daysSincePublication: number): string {
  if (daysSincePublication <= 0) {
    return "published today";
  }
  if (daysSincePublication === 1) {
    return "published yesterday";
  }
  return `published ${plural(daysSincePublication, "day")} ago`;
}

const GROUP_ORDER: Readonly<Record<ObligationGroup, number>> = {
  overdue: 0,
  today: 1,
  this_week: 2,
  upcoming: 3,
};

/**
 * Overdue first, then by how late, then oldest due date.
 *
 * S-02's whole promise is "overdue first", so the ordering is part of the
 * contract rather than a detail of the screen, and it is sorted here so the
 * badge, the page and any later channel agree on which obligation is the most
 * pressing one.
 */
export function sortObligations(
  obligations: readonly Obligation[],
): Obligation[] {
  return [...obligations].sort((left, right) => {
    const byGroup = GROUP_ORDER[left.group] - GROUP_ORDER[right.group];
    if (byGroup !== 0) {
      return byGroup;
    }
    const byDays = (right.daysPastDue ?? 0) - (left.daysPastDue ?? 0);
    if (byDays !== 0) {
      return byDays;
    }
    return (left.dueOn ?? "").localeCompare(right.dueOn ?? "");
  });
}

export interface ObligationCounts {
  readonly overdue: number;
  readonly today: number;
  readonly thisWeek: number;
  readonly upcoming: number;
  readonly total: number;
  /**
   * What the sidebar badge shows: overdue plus due today.
   *
   * A badge counting everything upcoming would never reach zero, and a badge
   * that never reaches zero stops being read. This is also the number the
   * mockup's "7" is: three overdue, two today, two agent proposals, which are
   * groupless and land in `today` once P4-T05 delivers them.
   */
  readonly actionable: number;
}

export function countObligations(
  obligations: readonly Obligation[],
): ObligationCounts {
  const inGroup = (group: ObligationGroup): number =>
    obligations.filter((item) => item.group === group).length;
  const overdue = inGroup("overdue");
  const today = inGroup("today");
  return {
    overdue,
    today,
    thisWeek: inGroup("this_week"),
    upcoming: inGroup("upcoming"),
    total: obligations.length,
    actionable: overdue + today,
  };
}
