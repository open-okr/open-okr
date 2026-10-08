/**
 * The Northwind year on the real calendar (P9-T22c-a,
 * `docs/design/northwind-year-seed.md` §2).
 *
 * The scenario is written for 2027 and its "before the year" chapter for 2026.
 * Akmal chose on 7 October 2026 that the demo follows the real clock, so the
 * scenario's year becomes the year that holds today and its "before the year"
 * the year before.
 *
 * **Each date keeps its distance from its quarter's first Monday.** A step on
 * Monday of week 3 lands on Monday of week 3 in any year, so the weekly rhythm
 * and every "W6" in the story stay true. Mapping by month and day instead
 * would move every Monday check-in to whatever weekday that date fell on.
 *
 * Pure date arithmetic on `YYYY-MM-DD` strings, in UTC, with no clock.
 */

/** The year the scenario is written for. */
const SCENARIO_YEAR = 2027;

const DAY_MS = 86_400_000;

const toTime = (on: string): number => Date.parse(`${on}T00:00:00Z`);
const toIso = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

/** The first and last day of the calendar quarter that holds a date. */
export function quarterOf(on: string): { startsOn: string; endsOn: string } {
  const year = Number(on.slice(0, 4));
  const month = Number(on.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3;
  const startsOn = toIso(Date.UTC(year, first, 1));
  const endsOn = toIso(Date.UTC(year, first + 3, 0));
  return { startsOn, endsOn };
}

/** The first Monday on or after a quarter's first day. */
export function firstMondayOf(quarterStart: string): string {
  const time = toTime(quarterStart);
  const weekday = new Date(time).getUTCDay();
  const ahead = (8 - weekday) % 7;
  return toIso(time + ahead * DAY_MS);
}

/**
 * A scenario date on the real calendar, given the year that holds today.
 *
 * The scenario's 2027 becomes `realYear`, its 2026 the year before and its
 * 2028 the year after. A date that would land past its quarter's last day,
 * because the real quarter's first Monday falls later than the scenario's,
 * is held on that last day.
 */
export function toReal(scenarioDate: string, realYear: number): string {
  const offset = Number(scenarioDate.slice(0, 4)) - SCENARIO_YEAR;
  const scenarioQuarter = quarterOf(scenarioDate);
  const days = Math.round(
    (toTime(scenarioDate) - toTime(firstMondayOf(scenarioQuarter.startsOn))) /
      DAY_MS,
  );
  const realQuarterStart = `${realYear + offset}${scenarioQuarter.startsOn.slice(4)}`;
  const realQuarter = quarterOf(realQuarterStart);
  const landed = toIso(
    toTime(firstMondayOf(realQuarter.startsOn)) + days * DAY_MS,
  );
  if (landed > realQuarter.endsOn) {
    return realQuarter.endsOn;
  }
  if (landed < realQuarter.startsOn) {
    return realQuarter.startsOn;
  }
  return landed;
}

/** `YYYY-MM-DD` of an instant, in UTC. */
export const isoDay = (at: Date): string => at.toISOString().slice(0, 10);

/** Days after a date. */
export const addDays = (on: string, days: number): string =>
  toIso(toTime(on) + days * DAY_MS);

/** The first day of a scenario month, on the real calendar's matching month. */
export function realMonthStart(
  scenarioMonth: string,
  realYear: number,
): string {
  const offset = Number(scenarioMonth.slice(0, 4)) - SCENARIO_YEAR;
  return `${realYear + offset}-${scenarioMonth.slice(5, 7)}-01`;
}
