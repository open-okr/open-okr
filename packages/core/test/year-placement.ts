/**
 * Where a year test places the Northwind year (P9-T22c-e-a).
 *
 * The seed writes what happened by a day on the real calendar. A file that
 * reads Q4 on a day this year's Q4 has not happened would read nothing, and
 * every expectation in it would wait. So each file places the year on the
 * latest real year whose dates it reads have passed: this year when they
 * have, the year before when they have not. It builds only to the last of
 * those dates, because the whole year is the slowest thing the suite builds.
 */
import { isoDay, toReal } from "../src/demo/year/calendar.ts";

export interface Placement {
  /** The real year the scenario's 2027 lands on. */
  readonly realYear: number;
  /** The last day built, `YYYY-MM-DD`. */
  readonly until: string;
  /** The builder's today: the last day built. */
  readonly today: Date;
  /** A scenario date on the placed calendar. */
  on(scenarioDate: string): string;
  /** Whether a scenario date is built. */
  by(scenarioDate: string): boolean;
}

export function placeYear(
  lastScenarioDate: string,
  now: Date = new Date(),
): Placement {
  const today = isoDay(now);
  const thisYear = Number(today.slice(0, 4));
  const realYear =
    toReal(lastScenarioDate, thisYear) <= today ? thisYear : thisYear - 1;
  const on = (scenarioDate: string) => toReal(scenarioDate, realYear);
  const until = on(lastScenarioDate);
  return {
    realYear,
    until,
    today: new Date(`${until}T12:00:00.000Z`),
    on,
    by: (scenarioDate) => on(scenarioDate) <= until,
  };
}
