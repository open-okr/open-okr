/**
 * METHOD.md §7.4, the rhythm streak (completeness review M-04, P9-T19a-d-b).
 *
 * "Consecutive check-in periods in which a space held its check-in, at
 * whatever frequency the space runs. A skipped period breaks it." It counted
 * weeks whatever the space ran, so a team on every two weeks broke its streak
 * every other week by doing exactly what it chose to do. Both halves are
 * here, pure, so the write and the read cannot disagree about what a period
 * is.
 *
 * Dates are local `YYYY-MM-DD` strings in the workspace timezone. A week
 * starts on Monday, as §7.2's weekly check-in does. A fortnight is two such
 * weeks counted from a fixed Monday, so two check-ins fourteen days apart are
 * always in consecutive fortnights whatever day the team started on. A month
 * is a calendar month and a quarter a calendar quarter. A space whose goals
 * check in daily still meets weekly, so its streak counts weeks.
 *
 * The stored columns keep their names, `current_weeks`, `longest_weeks` and
 * `last_session_week`: they count periods now, and the last one is the start
 * of the last period held.
 *
 * **A period marked as a holiday does not break it** (P9-T19b-a): "A skipped
 * period breaks it; a period marked as a holiday does not." A period is a
 * holiday when its last working day is inside a span the space marked, which
 * is the day a check-in for it is last due. The due dates, the booking and the
 * nudges read the same rule from here, so a week nothing was due in cannot
 * still break the streak.
 */
import type { CheckInFrequency } from "./thresholds.ts";

const DAY_MS = 86_400_000;
const toTime = (on: string): number => Date.parse(`${on}T00:00:00Z`);
const addDays = (on: string, days: number): string =>
  new Date(toTime(on) + days * DAY_MS).toISOString().slice(0, 10);

/** A Monday every fortnight is counted from. Any Monday would do. */
const FORTNIGHT_EPOCH = "2024-01-01";

/** The Monday of the week holding this date. */
export function weekStartOf(on: string): string {
  const day = new Date(toTime(on)).getUTCDay();
  return addDays(on, day === 0 ? -6 : 1 - day);
}

/** The first day of the check-in period holding this date. */
export function periodStartOf(on: string, frequency: CheckInFrequency): string {
  switch (frequency) {
    case "biweekly": {
      const monday = weekStartOf(on);
      const weeks = Math.round(
        (toTime(monday) - toTime(FORTNIGHT_EPOCH)) / (7 * DAY_MS),
      );
      const offset = ((weeks % 2) + 2) % 2;
      return addDays(monday, -7 * offset);
    }
    case "monthly":
      return `${on.slice(0, 7)}-01`;
    case "quarterly": {
      const month = Number(on.slice(5, 7));
      const first = month - ((month - 1) % 3);
      return `${on.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
    }
    default:
      // Weekly, and daily, whose team still meets weekly.
      return weekStartOf(on);
  }
}

/** The first day of the period after the one starting on `start`. */
export function nextPeriodStart(
  start: string,
  frequency: CheckInFrequency,
): string {
  switch (frequency) {
    case "biweekly":
      return addDays(start, 14);
    case "monthly":
    case "quarterly": {
      const months = frequency === "monthly" ? 1 : 3;
      const year = Number(start.slice(0, 4));
      const month = Number(start.slice(5, 7)) - 1 + months;
      const next = new Date(Date.UTC(year, month, 1));
      return next.toISOString().slice(0, 10);
    }
    default:
      return addDays(start, 7);
  }
}

/** The first day of the period before the one starting on `start`. */
export function previousPeriodStart(
  start: string,
  frequency: CheckInFrequency,
): string {
  return periodStartOf(addDays(start, -1), frequency);
}

/** The last day of the check-in period holding this date. */
export function periodEndOf(on: string, frequency: CheckInFrequency): string {
  return addDays(nextPeriodStart(periodStartOf(on, frequency), frequency), -1);
}

/** The last working day, Monday to Friday, of the period holding this date. */
export function lastWorkingDayOfPeriod(
  on: string,
  frequency: CheckInFrequency,
): string {
  let day = periodEndOf(on, frequency);
  for (let guard = 0; guard < 3; guard += 1) {
    const weekday = new Date(toTime(day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      break;
    }
    day = addDays(day, -1);
  }
  return day;
}

/** A span a space marked as a holiday, both days included (METHOD.md §7.4). */
export interface Holiday {
  readonly startsOn: string;
  readonly endsOn: string;
}

/** Whether a date is inside a marked holiday. */
export function isHoliday(on: string, holidays: readonly Holiday[]): boolean {
  return holidays.some(
    (holiday) => holiday.startsOn <= on && on <= holiday.endsOn,
  );
}

/**
 * Whether the check-in period holding `on` is a holiday: its last working day
 * is inside a marked span. A team back on the Friday still owes that week.
 */
export function isHolidayPeriod(
  on: string,
  frequency: CheckInFrequency,
  holidays: readonly Holiday[],
): boolean {
  return (
    holidays.length > 0 &&
    isHoliday(lastWorkingDayOfPeriod(on, frequency), holidays)
  );
}

/**
 * Whether every period strictly between two period starts is a holiday, so
 * nothing between them was owed. With no holidays it is whether they are
 * neighbours.
 */
function onlyHolidaysBetween(
  from: string,
  to: string,
  frequency: CheckInFrequency,
  holidays: readonly Holiday[],
): boolean {
  let period = nextPeriodStart(from, frequency);
  // Bounded: a run of holidays longer than two years is not a rhythm.
  for (let guard = 0; guard < 120 && period < to; guard += 1) {
    if (!isHolidayPeriod(period, frequency, holidays)) {
      return false;
    }
    period = nextPeriodStart(period, frequency);
  }
  return period >= to;
}

export interface StreakState {
  readonly currentWeeks: number;
  readonly longestWeeks: number;
  /** The start of the last period a check-in was held, or null for never. */
  readonly lastWeek: string | null;
}

/**
 * The streak after a check-in session closes on `heldOn`, counted in the
 * space's own periods.
 *
 * A second check-in in the same period changes nothing. The period straight
 * after the last one extends the run. Any later period starts a new run of
 * one, because the periods between were skipped. A close for a period before
 * the last one counted is history arriving late and changes nothing either.
 *
 * The last period is read again at the current frequency, so a space that
 * changes its frequency keeps its run where the new periods line up. Holiday
 * periods between the two are not skipped periods, and a check-in held in a
 * holiday still counts.
 */
export function afterCheckIn(
  state: StreakState | null,
  heldOn: string,
  frequency: CheckInFrequency = "weekly",
  holidays: readonly Holiday[] = [],
): StreakState {
  const period = periodStartOf(heldOn, frequency);
  if (!state || state.lastWeek === null) {
    return {
      currentWeeks: 1,
      longestWeeks: Math.max(state?.longestWeeks ?? 0, 1),
      lastWeek: period,
    };
  }
  const last = periodStartOf(state.lastWeek, frequency);
  if (period <= last) {
    return state;
  }
  const currentWeeks = onlyHolidaysBetween(last, period, frequency, holidays)
    ? state.currentWeeks + 1
    : 1;
  return {
    currentWeeks,
    longestWeeks: Math.max(state.longestWeeks, currentWeeks),
    lastWeek: period,
  };
}

/**
 * The run as it stands on `today`.
 *
 * Alive while the last check-in was in this period or the one before: this
 * period's may simply not have happened yet. Once a whole period has passed
 * with none, it is broken, whether or not anybody pressed "skip". A holiday
 * period that passed with none is not a skipped period.
 */
export function currentStreakOn(
  state: StreakState | null,
  today: string,
  frequency: CheckInFrequency = "weekly",
  holidays: readonly Holiday[] = [],
): number {
  if (!state || state.lastWeek === null) {
    return 0;
  }
  const current = periodStartOf(today, frequency);
  const last = periodStartOf(state.lastWeek, frequency);
  return last >= current ||
    onlyHolidaysBetween(last, current, frequency, holidays)
    ? state.currentWeeks
    : 0;
}
