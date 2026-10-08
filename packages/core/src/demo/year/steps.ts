/**
 * Every step of the Northwind year, with the dates the scenario gives it
 * (P9-T22c-a, `docs/scenarios/northwind-year/05-scenario-index.md`).
 *
 * A step is the scenario's own unit, NW-Q1-17, and is not the same thing as
 * the seed's events: one step can leave several rows and some leave none
 * (`docs/design/northwind-year-seed.md` §3, §5). This list answers one
 * question with no database and no clock: as of a day, which steps are done,
 * under way or not yet. That is what lets the README's five demo dates be
 * tested on any day of the year.
 *
 * Dates are the scenario's, 2026 and 2027, exactly as the chapters print them.
 * A step that runs over days carries its first and last.
 */
import { toReal } from "./calendar.ts";

export interface YearStep {
  readonly id: string;
  readonly from: string;
  /** The last day, where the step runs over more than one. */
  readonly to?: string;
}

const step = (id: string, from: string, to?: string): YearStep =>
  to ? { id, from, to } : { id, from };

export const YEAR_STEPS: readonly YearStep[] = [
  // 0. Before the year
  step("NW-P-01", "2026-09-28"),
  step("NW-P-02", "2026-10-01"),
  step("NW-P-03", "2026-10-05", "2026-11-30"),
  step("NW-P-04", "2026-11-20", "2026-11-26"),
  step("NW-P-05", "2026-11-25"),
  step("NW-P-06", "2026-11-25"),
  step("NW-P-07", "2026-11-30"),
  step("NW-P-08", "2026-12-01"),
  step("NW-P-09", "2026-12-02"),
  step("NW-P-10", "2026-12-02", "2026-12-11"),
  step("NW-P-11", "2026-12-03"),
  step("NW-P-12", "2026-12-07"),
  step("NW-P-13", "2026-12-14"),
  step("NW-P-14", "2026-12-18"),
  step("NW-P-15", "2026-12-21"),
  // 1. Q1: the rollout
  step("NW-Q1-01", "2026-12-04"),
  step("NW-Q1-02", "2026-12-15"),
  step("NW-Q1-03", "2026-12-16"),
  step("NW-Q1-04", "2026-12-16", "2026-12-22"),
  step("NW-Q1-05", "2026-12-23"),
  step("NW-Q1-06", "2027-01-04"),
  step("NW-Q1-07", "2027-01-05"),
  step("NW-Q1-08", "2027-01-05"),
  step("NW-Q1-09", "2027-01-06"),
  step("NW-Q1-10", "2027-01-07"),
  step("NW-Q1-11", "2027-01-07"),
  step("NW-Q1-12", "2027-01-12"),
  step("NW-Q1-13", "2027-01-13"),
  step("NW-Q1-14", "2027-01-15"),
  step("NW-Q1-15", "2027-01-18"),
  step("NW-Q1-16", "2027-01-24", "2027-01-27"),
  step("NW-Q1-17", "2027-02-01"),
  step("NW-Q1-18", "2027-02-01"),
  step("NW-Q1-19", "2027-02-08"),
  step("NW-Q1-20", "2027-02-12", "2027-02-15"),
  step("NW-Q1-21", "2027-02-22"),
  step("NW-Q1-22", "2027-02-26"),
  step("NW-Q1-23", "2027-03-01"),
  step("NW-Q1-24", "2027-03-03"),
  step("NW-Q1-25", "2027-03-08"),
  step("NW-Q1-26", "2027-03-15", "2027-03-22"),
  step("NW-Q1-27", "2027-03-18"),
  step("NW-Q1-28", "2027-03-18"),
  step("NW-Q1-29", "2027-03-18", "2027-04-02"),
  step("NW-Q1-30", "2027-03-18"),
  step("NW-Q1-31", "2027-03-18"),
  step("NW-Q1-32", "2027-03-19"),
  // 2. Q2: the competitor
  step("NW-Q2-01", "2027-03-19", "2027-03-29"),
  step("NW-Q2-02", "2027-04-02"),
  step("NW-Q2-03", "2027-04-02"),
  step("NW-Q2-04", "2027-04-05", "2027-04-14"),
  step("NW-Q2-05", "2027-04-12"),
  step("NW-Q2-06", "2027-04-15"),
  step("NW-Q2-07", "2027-04-19"),
  step("NW-Q2-08", "2027-05-03"),
  step("NW-Q2-09", "2027-05-10"),
  step("NW-Q2-10", "2027-05-12"),
  step("NW-Q2-11", "2027-05-12"),
  step("NW-Q2-12", "2027-05-13", "2027-05-21"),
  step("NW-Q2-13", "2027-05-14"),
  step("NW-Q2-14", "2027-05-17"),
  step("NW-Q2-15", "2027-05-17"),
  step("NW-Q2-16", "2027-05-31"),
  step("NW-Q2-17", "2027-06-07"),
  step("NW-Q2-18", "2027-06-07"),
  step("NW-Q2-19", "2027-06-14", "2027-06-15"),
  step("NW-Q2-20", "2027-06-16"),
  step("NW-Q2-21", "2027-06-18"),
  step("NW-Q2-22", "2027-06-21"),
  step("NW-Q2-23", "2027-06-21"),
  // 3. Q3: the long summer
  step("NW-Q3-01", "2027-06-21", "2027-06-28"),
  step("NW-Q3-02", "2027-07-01"),
  step("NW-Q3-03", "2027-07-05"),
  step("NW-Q3-04", "2027-07-06"),
  step("NW-Q3-05", "2027-07-01", "2027-09-30"),
  step("NW-Q3-06", "2027-07-12", "2027-08-27"),
  step("NW-Q3-07", "2027-07-26"),
  step("NW-Q3-08", "2027-07-30"),
  step("NW-Q3-09", "2027-08-09"),
  step("NW-Q3-10", "2027-08-16"),
  step("NW-Q3-11", "2027-08-23"),
  step("NW-Q3-12", "2027-08-27", "2027-09-01"),
  step("NW-Q3-13", "2027-09-10"),
  step("NW-Q3-14", "2027-09-13", "2027-09-14"),
  step("NW-Q3-15", "2027-09-15"),
  step("NW-Q3-16", "2027-09-16"),
  // 4. Q4: renewals and the year-end
  step("NW-Q4-01", "2027-09-03", "2027-09-27"),
  step("NW-Q4-02", "2027-10-25"),
  step("NW-Q4-03", "2027-11-20", "2027-12-01"),
  step("NW-Q4-04", "2027-12-03"),
  step("NW-Q4-05", "2027-12-06"),
  step("NW-Q4-06", "2027-12-08"),
  step("NW-Q4-07", "2027-12-09"),
  step("NW-Q4-08", "2027-12-09", "2027-12-17"),
  step("NW-Q4-09", "2027-12-13", "2027-12-14"),
  step("NW-Q4-10", "2027-12-15"),
  step("NW-Q4-11", "2027-12-16"),
  step("NW-Q4-12", "2027-12-16"),
  step("NW-Q4-13", "2027-12-17"),
  step("NW-Q4-14", "2027-12-20", "2027-12-22"),
  step("NW-Q4-15", "2027-12-23"),
  step("NW-Q4-16", "2027-12-24"),
];

export type StepState = "done" | "underWay" | "notYet";

/**
 * Where each step stands on a real day, with the year placed on the real
 * calendar (`toReal`). Done once its last day has come; under way between
 * its first and its last.
 */
export function yearStepsAsOf(today: string): ReadonlyMap<string, StepState> {
  const realYear = Number(today.slice(0, 4));
  const states = new Map<string, StepState>();
  for (const one of YEAR_STEPS) {
    const from = toReal(one.from, realYear);
    const to = toReal(one.to ?? one.from, realYear);
    states.set(
      one.id,
      to <= today ? "done" : from <= today ? "underWay" : "notYet",
    );
  }
  return states;
}
