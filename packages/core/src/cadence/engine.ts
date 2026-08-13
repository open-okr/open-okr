/**
 * The cadence engine (TECHNICAL-PLAN §6.3, METHOD.md §7, §11, P3-T06).
 *
 * The engine that makes health honest. If the next due date is wrong, staleness
 * is wrong, and a neglected goal quietly stays green, which is the one thing
 * METHOD.md §1 principle 8 forbids.
 *
 * Pure date arithmetic. No database, no clock: the reference date is always an
 * argument.
 *
 * **Every step runs on the calendar, and conversion to an instant happens once,
 * at the end.** A daylight-saving shift must never move a Monday deadline to a
 * Sunday, and arithmetic on instants does exactly that: two Mondays a week apart
 * in Berlin are 167 hours apart in absolute terms, not 168.
 *
 * The escalation ladder itself lives in `packages/method`, because which roles it
 * widens to is §11 practice rather than date arithmetic.
 */
import type { CheckInFrequency } from "@openokr/method";
import {
  addDays,
  formatLocalDate,
  type LocalDate,
  parseLocalDate,
} from "../cycles/generation.ts";

/**
 * An ISO weekday 1 to 7 for `weekly` and `biweekly`, a day of month 1 to 31 for
 * `monthly` and `quarterly`, and unused for `daily` (decision D-14).
 */
export type CadenceAnchor = number;

const MS_PER_DAY = 86_400_000;

const toUtc = (date: LocalDate): number =>
  Date.UTC(date.year, date.month - 1, date.day);

/** ISO weekday, Monday 1 through Sunday 7. */
function isoWeekday(date: LocalDate): number {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The anchor day of a month, clamped to the month's length.
 *
 * Clamping is not sticky: this always reads the anchor, never the last clamped
 * result. Anchor 31 gives 31 January, 28 February, 31 March. Stepping from the
 * clamped 28 February would silently rewrite the anchor to 28.
 */
function monthAnchor(
  year: number,
  month: number,
  anchor: CadenceAnchor,
): LocalDate {
  return { year, month, day: Math.min(anchor, daysInMonth(year, month)) };
}

function addMonths(
  date: { year: number; month: number },
  months: number,
): { year: number; month: number } {
  const zeroBased = date.month - 1 + months;
  return {
    year: date.year + Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

const daysBetween = (from: LocalDate, to: LocalDate): number =>
  Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);

const isOnOrBefore = (a: LocalDate, b: LocalDate): boolean =>
  toUtc(a) <= toUtc(b);

/**
 * One period on from a due date.
 *
 * Weeks step by 7 days rather than searching for the next anchor weekday: the
 * weekday is already baked into the first due date, so addition preserves it and
 * cannot drift. Months and quarters recompute from the anchor.
 */
function advance(
  due: LocalDate,
  frequency: CheckInFrequency,
  anchor: CadenceAnchor,
): LocalDate {
  switch (frequency) {
    case "daily":
      return addDays(due, 1);
    case "weekly":
      return addDays(due, 7);
    case "biweekly":
      return addDays(due, 14);
    case "monthly": {
      const next = addMonths(due, 1);
      return monthAnchor(next.year, next.month, anchor);
    }
    case "quarterly": {
      // Three months from the due date, not from the calendar quarter. A
      // check-in rhythm belongs to the goal; cycles are what the fiscal
      // calendar anchors.
      const next = addMonths(due, 3);
      return monthAnchor(next.year, next.month, anchor);
    }
    default:
      return addDays(due, 7);
  }
}

/**
 * The first occurrence strictly after a reference date.
 *
 * Strictly after, deliberately: the anchor day is a deadline, and a goal created
 * at 4pm on its own anchor day has not had a period to report on yet.
 */
export function firstDue(
  from: LocalDate,
  frequency: CheckInFrequency,
  anchor: CadenceAnchor,
): LocalDate {
  if (frequency === "daily") {
    return addDays(from, 1);
  }

  if (frequency === "weekly" || frequency === "biweekly") {
    const current = isoWeekday(from);
    const ahead = (anchor - current + 7) % 7;
    // Zero means the reference date is itself the anchor day, so the next one is
    // a full week out.
    return addDays(from, ahead === 0 ? 7 : ahead);
  }

  const thisMonth = monthAnchor(from.year, from.month, anchor);
  if (toUtc(thisMonth) > toUtc(from)) {
    return thisMonth;
  }
  const step = frequency === "quarterly" ? 3 : 1;
  const next = addMonths(from, step);
  return monthAnchor(next.year, next.month, anchor);
}

interface AfterPublication {
  readonly next: LocalDate;
  /** True when the period that just ended was missed, which the streak reads. */
  readonly missedPeriod: boolean;
}

/**
 * The next due date after a check-in is published, and whether the period was
 * met.
 *
 * Two rules, and the order matters. Advance one period **from the due date**,
 * never from the publication date, so a Tuesday check-in does not move a Monday
 * rhythm. Then keep advancing while the result is on or before the publication
 * date, so a champion who vanishes for a month does not return to a backlog of
 * four overdue periods.
 *
 * The tolerance does not change the next due date. It decides whether the period
 * that just ended was met or missed. A publication before the due date is never
 * missed, however early it is.
 */
function nextAfterPublication(
  due: LocalDate,
  publishedOn: LocalDate,
  frequency: CheckInFrequency,
  anchor: CadenceAnchor,
  toleranceDays: number,
): AfterPublication {
  let next = advance(due, frequency, anchor);
  // Bounded so a pathological input cannot spin: a daily goal published ten
  // years late is 3,650 steps, and beyond that the rhythm is not the problem.
  for (
    let guard = 0;
    guard < 4000 && isOnOrBefore(next, publishedOn);
    guard += 1
  ) {
    next = advance(next, frequency, anchor);
  }

  const lateness = daysBetween(due, publishedOn);
  return { next, missedPeriod: lateness > toleranceDays };
}

/**
 * The instant a due date expires: the local end of that date in the workspace
 * timezone.
 *
 * `23:59:59.999` rather than the following midnight, because a check-in posted at
 * any hour of the due date is on time, which is what a human means by "due
 * Monday". It also avoids the local midnight that does not exist on some
 * transition days.
 *
 * The offset is read from the zone at that date rather than assumed, which is the
 * whole point of doing the arithmetic on local dates first.
 */
export function dueInstant(due: LocalDate, timeZone: string): Date {
  const naive = Date.UTC(due.year, due.month - 1, due.day, 23, 59, 59, 999);
  // The zone's offset at that moment, found by asking what local time the naive
  // instant reads as. One correction is enough for every real zone; a second
  // pass settles the rare case where the first lands on the other side of a
  // transition.
  let instant = naive - offsetAt(naive, timeZone);
  instant = naive - offsetAt(instant, timeZone);
  return new Date(instant);
}

/** How far ahead of UTC a zone is at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  // `en-CA` renders midnight as 24 in some runtimes.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
    instant % 1000,
  );
  return asUtc - instant;
}

/**
 * §3.5 and §5 of the cadence design: outdated once today is past the grace.
 *
 * The boundary is exclusive. At exactly the grace limit the goal is not yet
 * outdated, which is the same rule the health matrix states.
 */
function isOutdated(
  due: LocalDate,
  today: LocalDate,
  graceDays: number,
): boolean {
  return daysBetween(due, today) > graceDays;
}

/** The string forms, for callers holding `date` columns rather than parts. */
export const cadence = {
  advance: (
    due: string,
    frequency: CheckInFrequency,
    anchor: CadenceAnchor,
  ): string => formatLocalDate(advance(parseLocalDate(due), frequency, anchor)),
  firstDue: (
    from: string,
    frequency: CheckInFrequency,
    anchor: CadenceAnchor,
  ): string =>
    formatLocalDate(firstDue(parseLocalDate(from), frequency, anchor)),
  nextAfterPublication: (
    due: string,
    publishedOn: string,
    frequency: CheckInFrequency,
    anchor: CadenceAnchor,
    toleranceDays: number,
  ): { next: string; missedPeriod: boolean } => {
    const result = nextAfterPublication(
      parseLocalDate(due),
      parseLocalDate(publishedOn),
      frequency,
      anchor,
      toleranceDays,
    );
    return {
      next: formatLocalDate(result.next),
      missedPeriod: result.missedPeriod,
    };
  },
  isOutdated: (due: string, today: string, graceDays: number): boolean =>
    isOutdated(parseLocalDate(due), parseLocalDate(today), graceDays),
};
