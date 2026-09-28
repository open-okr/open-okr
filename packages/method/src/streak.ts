/**
 * METHOD.md §7.4, the rhythm streak (completeness review M-04).
 *
 * "Consecutive weeks in which a space held its check-in. A skipped week breaks
 * it." The close path counted sessions rather than weeks, of every kind, and
 * nothing ever broke the run: a monthly review added a week, two check-ins in
 * one week added two, and a space silent for a month still showed its old
 * number. Both halves are here, pure, so the write and the read cannot
 * disagree about what a week is.
 *
 * Dates are local `YYYY-MM-DD` strings in the workspace timezone, and a week
 * starts on Monday, as §7.2's weekly check-in does.
 */

const DAY_MS = 86_400_000;
const toTime = (on: string): number => Date.parse(`${on}T00:00:00Z`);
const addDays = (on: string, days: number): string =>
  new Date(toTime(on) + days * DAY_MS).toISOString().slice(0, 10);

/** The Monday of the week holding this date. */
export function weekStartOf(on: string): string {
  const day = new Date(toTime(on)).getUTCDay();
  return addDays(on, day === 0 ? -6 : 1 - day);
}

export interface StreakState {
  readonly currentWeeks: number;
  readonly longestWeeks: number;
  /** The Monday of the last week a check-in was held, or null for never. */
  readonly lastWeek: string | null;
}

/**
 * The streak after a weekly check-in closes on `heldOn`.
 *
 * A second check-in in the same week changes nothing. The week straight after
 * the last one extends the run. Any later week starts a new run of one,
 * because the weeks between were skipped. A close for a week before the last
 * one counted is history arriving late and changes nothing either.
 */
export function afterWeeklyCheckIn(
  state: StreakState | null,
  heldOn: string,
): StreakState {
  const week = weekStartOf(heldOn);
  if (!state || state.lastWeek === null) {
    return {
      currentWeeks: 1,
      longestWeeks: Math.max(state?.longestWeeks ?? 0, 1),
      lastWeek: week,
    };
  }
  if (week <= state.lastWeek) {
    return state;
  }
  const currentWeeks =
    week === addDays(state.lastWeek, 7) ? state.currentWeeks + 1 : 1;
  return {
    currentWeeks,
    longestWeeks: Math.max(state.longestWeeks, currentWeeks),
    lastWeek: week,
  };
}

/**
 * The run as it stands on `today`.
 *
 * Alive while the last check-in was this week or last week: this week's may
 * simply not have happened yet. Once a whole week has passed with none, it is
 * broken, whether or not anybody pressed "skip".
 */
export function currentStreakOn(
  state: StreakState | null,
  today: string,
): number {
  if (!state || state.lastWeek === null) {
    return 0;
  }
  return state.lastWeek >= addDays(weekStartOf(today), -7)
    ? state.currentWeeks
    : 0;
}
